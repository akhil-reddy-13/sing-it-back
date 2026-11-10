// Writes tests/fixtures/parity.json: synthetic tracks + the JS scores, for the Python parity test.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resample, trackPitch, scoreTrial, packTrack, SR } from "../public/js/pitch.js";
import { singMelody } from "./synth.mjs";
const songs = JSON.parse(readFileSync(new URL("../public/songs.json", import.meta.url)));
const HB = songs.songs.find((s) => s.id === "happy_birthday");
const cases = [];
for (const [k, off] of [0, 2.5, -4.1, 5.2, -1 - 12].entries()) {
  const tr = trackPitch(resample(singMelody(HB.reference.template, { offset: off, seed: 20 + k }), 48000, SR), SR);
  const song = k % 2 ? HB : { ...HB, reference: { ...HB.reference, tonic: "D", mode: "minor", template: null, anchor_note: "A4" } };
  cases.push({ offset: off, song, track: packTrack(tr), js: scoreTrial(tr, song) });
}
mkdirSync(new URL("./fixtures/", import.meta.url), { recursive: true });
writeFileSync(new URL("./fixtures/parity.json", import.meta.url), JSON.stringify(cases));
console.log("wrote", cases.length, "cases");
