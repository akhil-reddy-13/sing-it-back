// Do the reliability gates (ambiguity <= 0.9, misfit <= 0.6, specificity margin >= 0)
// keep right-song takes and reject wrong-song takes?
// Usage: node tests/benchmark_gates.mjs [n_per_song=40]
import { readFileSync } from "node:fs";
import { trackPitch, scoreTrial, wrap12, mulberry32, SR } from "../public/js/pitch.js";
import { singMelody } from "./synth.mjs";
const N = +(process.argv[2] || 40);
const songs = JSON.parse(readFileSync(new URL("../public/songs.json", import.meta.url))).songs.filter((s) => s.reference?.template?.length);
const pass = (sc) => sc.template && sc.template.ambiguity <= 0.9 && sc.template.cost <= 0.6 && (!sc.specificity || sc.specificity.margin >= (process.env.MARGIN !== undefined ? +process.env.MARGIN : 0));
const rand = mulberry32(99);
function take(tmpl) {
  const L = tmpl.length, len = Math.max(6, Math.round(L * (0.6 + 0.4 * rand()))), st = Math.floor(rand() * (L - len + 1));
  const oct = [-12, 0, 0, 12][Math.floor(rand() * 4)];
  return singMelody(tmpl.slice(st, st + len).map((n) => ({ ...n, midi: n.midi + oct })), { sr: SR, offset: -6 + 12 * rand(), bpm: 80 + 50 * rand(), jitterSt: 0.12 + 0.25 * rand(), flat: (rand() * 2 - 1) * 0.06, noise: 0.004, seed: 1 + Math.floor(rand() * 1e9) });
}
let right = 0, rightOk = 0, rightErr = 0, wrong = 0, wrongOk = 0;
const perSong = [];
for (const song of songs.filter((s) => s.role === "target")) {
  let r = 0, w = 0;
  for (let i = 0; i < N; i++) {
    // right song
    const truthTake = take(song.reference.template);
    // (truth offset not tracked here; benchmark_scorer.mjs covers accuracy)
    const a = scoreTrial(trackPitch(truthTake, SR), song, {}, songs);
    right++; if (pass(a)) { rightOk++; r++; }
    // wrong song: another song's melody (incl. Happy Birthday) sung to this prompt
    const other = songs.filter((s) => s.id !== song.id)[Math.floor(rand() * (songs.length - 1))];
    const b = scoreTrial(trackPitch(take(other.reference.template), SR), song, {}, songs);
    wrong++; if (pass(b)) { wrongOk++; w++; }
  }
  perSong.push(`${song.id.padEnd(26)} right kept ${String(Math.round(100 * r / N)).padStart(3)}%   wrong let through ${String(Math.round(100 * w / N)).padStart(3)}%`);
}
console.log(perSong.join("\n"));
console.log(`\nALL  right-song takes kept: ${Math.round(100 * rightOk / right)}%   wrong-song takes let through: ${Math.round(100 * wrongOk / wrong)}%`);
