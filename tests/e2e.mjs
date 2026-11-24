// End-to-end smoke test. Usage: node tests/e2e.mjs [baseUrl] [screenshotDir]
// Drives the whole participant flow in headless Chrome with a synthetic singer as the mic.
// With a screenshot dir, saves a desktop and phone-width screenshot of every screen.
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://localhost:3000";
const SHOTS = process.argv[3] || null;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const wav = fileURLToPath(new URL("./.fake_mic.wav", import.meta.url)); // must be readable by Chrome
execFileSync("node", [fileURLToPath(new URL("./make_fake_mic.mjs", import.meta.url)), wav], { stdio: "inherit" });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const saves = { ok: 0, failed: [] };
page.on("response", (r) => {
  if (!r.url().includes("/api/event")) return;
  if (r.ok()) saves.ok++; else saves.failed.push(`${r.status()} ${r.url()}`);
});
let sessionId = null;
page.on("request", (r) => {
  if (!r.url().includes("/api/event") || sessionId) return;
  try { sessionId = JSON.parse(r.postData() || "{}").session_id || null; } catch {}
});
page.on("requestfailed", (r) => errors.push("request failed: " + r.url() + " " + r.failure()?.errorText));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (sel) => { await page.waitForSelector(sel + ":not([disabled])", { visible: true, timeout: 30000 }); await page.click(sel); };
const step = (s) => console.log("·", s);
let shotN = 0;
const shot = async (name) => {
  if (!SHOTS) return;
  await sleep(450); // let the entrance animation finish
  const n = String(++shotN).padStart(2, "0");
  await page.screenshot({ path: `${SHOTS}/${n}_${name}_desktop.png`, fullPage: true });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await sleep(150);
  await page.screenshot({ path: `${SHOTS}/${n}_${name}_phone.png`, fullPage: true });
  await page.setViewport({ width: 1100, height: 900 });
};

await page.goto(BASE, { waitUntil: "networkidle0" });
step("welcome"); await page.waitForSelector("#go"); await shot("welcome"); await click("#go");
step("consent"); await page.waitForSelector("#c_ok"); await shot("consent"); await click("#c_ok"); await click("#go");
step("mic"); await page.waitForSelector("#go"); await shot("mic_allow"); await click("#go");
await page.waitForSelector("#rec"); await shot("mic_test"); await click("#rec");
await page.waitForSelector("#next:not([disabled])", { visible: true, timeout: 20000 });
step("mic result: " + (await page.$eval("#msg", (e) => e.textContent.trim())));
await shot("mic_done"); await click("#next");

step("pick songs");
await page.waitForSelector(".chip");
await page.evaluate(() => [...document.querySelectorAll(".chip")].slice(0, 4).forEach((c) => c.click()));
await shot("songs"); await click("#go");
step("sing intro"); await page.waitForSelector("#go"); await shot("sing_intro"); await click("#go");
for (let t = 0; t < 8; t++) {
  if (!(await page.$(".trial"))) break;
  const title = await page.$eval(".songtitle", (e) => e.textContent);
  if (t === 0) await shot("trial_ready");
  await click("#rec"); await sleep(t === 0 ? 2000 : 0); if (t === 0) await shot("trial_recording");
  await sleep(t === 0 ? 5000 : 7000); await click("#rec");
  await page.waitForFunction(() => document.querySelector("#next") || document.querySelector("#again"), { timeout: 30000 });
  if (t === 0) await shot("trial_done");
  if (await page.$("#again")) { step(`trial ${t + 1} (${title}): too little voice, skipping`); await click("#skip"); continue; }
  await click("#next");
  step(`trial ${t + 1}: ${title}`);
  await sleep(300);
}
step("naming"); await page.waitForSelector("#skip"); await shot("naming_intro"); await click("#go");
for (let k = 0; k < 12; k++) {
  await click('#kbd button[data-pc="' + (k % 12) + '"]');
  if (k === 2) await shot("naming");
}
step("about you");
await page.waitForSelector("#native", { timeout: 60000 });
await page.click('#native .chip[data-lang="Mandarin"]');
await page.waitForSelector('#fluency input[name="flu_mandarin"]');
await page.click('#fluency input[name="flu_mandarin"][value="3"]');
await page.click('input[name="lessons"][value="2-5"]');
await page.click('input[name="lesson_age"][value="le6"]');
await page.click('input[name="solfege"][value="fixed"]');
await page.click('input[name="ap_self"][value="no"]');
await page.type("#age", "20");
await shot("about");
await click("#go");
await page.waitForSelector(".big", { timeout: 10000 });
await shot("results");
const resultText = await page.$eval("main", (e) => e.innerText);
console.log("\n--- results screen ---\n" + resultText.split("\n").slice(0, 16).join("\n"));
await sleep(1500);
await browser.close();
console.log(`\nsaves: ${saves.ok} ok, ${saves.failed.length} failed` + (sessionId ? `  (session ${sessionId})` : ""));
if (saves.failed.length) errors.push("event saves failed:\n" + saves.failed.join("\n"));
if (errors.length) { console.error("\nPAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
