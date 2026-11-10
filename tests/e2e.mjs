// End-to-end smoke test. Usage: node tests/e2e.mjs [baseUrl]
// Drives the whole participant flow in headless Chrome with a synthetic singer as the mic.
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] || "http://localhost:3000";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const wav = new URL("./.fake_mic.wav", import.meta.url).pathname; // must be readable by Chrome
execFileSync("node", [new URL("./make_fake_mic.mjs", import.meta.url).pathname, wav], { stdio: "inherit" });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("requestfailed", (r) => errors.push("request failed: " + r.url() + " " + r.failure()?.errorText));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (sel) => { await page.waitForSelector(sel + ":not([disabled])", { visible: true, timeout: 20000 }); await page.click(sel); };
const step = (s) => console.log("·", s);

await page.goto(BASE, { waitUntil: "networkidle0" });
step("welcome"); await click("#go");
step("consent"); await click("#c_age"); await click("#c_ok"); await click("#go");
const clickText = async (re) => {
  await page.waitForFunction((r) => [...document.querySelectorAll("button")].some((b) => new RegExp(r).test(b.textContent) && !b.disabled), { timeout: 20000 }, re);
  await page.evaluate((r) => [...document.querySelectorAll("button")].find((b) => new RegExp(r).test(b.textContent) && !b.disabled).click(), re);
};
step("mic"); await clickText("Allow microphone");
await clickText("Measure room noise");
await clickText("Test my voice");
await page.waitForFunction(() => /Continue/.test(document.body.innerText) && [...document.querySelectorAll("button")].some((b) => /Continue/.test(b.textContent) && !b.disabled), { timeout: 20000 });
const micMsg = await page.$eval("#msg", (e) => e.textContent);
step("mic result: " + micMsg.trim());
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((b) => /Continue/.test(b.textContent)); b.click(); });
step("familiarity");
await page.waitForSelector(".song");
await page.evaluate(() => document.querySelectorAll(".song").forEach((row, i) => {
  const v = i < 3 ? 5 : i < 5 ? 4 : 1;
  row.querySelector(`input[value="${v}"]`).click();
  const sel = row.querySelector("select"); if (v >= 4) { sel.value = "original"; sel.dispatchEvent(new Event("change", { bubbles: true })); }
}));
await click("#go");
step("sing intro"); await click("#go");
for (let t = 0; t < 10; t++) {
  const onTrial = await page.$(".trial");
  if (!onTrial) break;
  const title = await page.$eval(".songtitle", (e) => e.textContent);
  await click("#rec"); await sleep(9000); await click("#stop");
  await page.waitForFunction(() => document.querySelector("#next") || document.querySelector("#again"), { timeout: 30000 });
  if (await page.$("#again")) { step(`trial ${t + 1} (${title}): too little voice, skipping`); await click("#skip"); continue; }
  const conf = await page.$("#conf");
  if (conf) await page.click('#conf input[value="3"]');
  await click("#next");
  step(`trial ${t + 1}: ${title}`);
  await sleep(300);
}
step("speech"); await click("#rec"); await sleep(3000); await click("#stop");
step("other language"); await click("#skip");
step("range"); await click("#rec"); await sleep(3000); await click("#stop");
step("naming"); await click("#go");
for (let k = 0; k < 24; k++) { await click('#kbd button[data-pc="' + (k % 12) + '"]'); }
step("questionnaire");
await page.waitForSelector(".langrow", { timeout: 120000 });
await page.type(".langrow .lname", "Mandarin");
await page.select("#lessons", "yes");
await page.type("#lesson_age", "6");
await page.select("#solfege", "fixed");
await page.type("#age", "20");
await click("#go");
await page.waitForSelector(".stat", { timeout: 10000 });
const resultText = await page.$eval("main", (e) => e.innerText);
console.log("\n--- results screen ---\n" + resultText.split("\n").slice(0, 25).join("\n"));
await sleep(1500);
await browser.close();
if (errors.length) { console.error("\nPAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
console.log("\nE2E OK");
