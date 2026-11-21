// Monte-Carlo accuracy benchmark for the scorer.
// Usage: node tests/benchmark_scorer.mjs [n_per_song=120] [song_id ...]
// For every song with a melody template, synthesizes imperfect "singers" at a random
// true transposition and checks how well each method recovers it. Singers have:
//   per-note intonation error, slow pitch drift, a random excerpt of the hook (50–100%),
//   0–2 wrong notes, random tempo, random octave, occasional octave flips mid-take, noise.
import { readFileSync } from "node:fs";
import { resample, trackPitch, scoreTrial, wrap12, mulberry32, SR } from "../public/js/pitch.js";
import { singMelody } from "./synth.mjs";

const N = +(process.argv[2] || 120);
const only = process.argv.slice(3);
const songs = JSON.parse(readFileSync(new URL("../public/songs.json", import.meta.url))).songs
  .filter((s) => s.reference?.template?.length && (!only.length || only.includes(s.id)));

function singer(tmpl, rand) {
  const L = tmpl.length;
  const len = Math.max(6, Math.round(L * (0.5 + 0.5 * rand())));
  const start = Math.floor(rand() * (L - len + 1));
  const oct = [-12, 0, 0, 12][Math.floor(rand() * 4)];
  let notes = tmpl.slice(start, start + len).map((n) => ({ ...n, midi: n.midi + oct }));
  const nWrong = Math.floor(rand() * 3);
  for (let k = 0; k < nWrong; k++) { const i = Math.floor(rand() * notes.length); notes[i] = { ...notes[i], midi: notes[i].midi + (rand() < 0.5 ? -1 : 1) * (1 + Math.floor(rand() * 2)) }; }
  if (rand() < 0.2) { const i = Math.floor(rand() * notes.length); for (let k = i; k < notes.length; k++) notes[k] = { ...notes[k], midi: notes[k].midi - 12 }; } // flips down an octave mid-take
  return { notes, jitter: 0.1 + 0.25 * rand(), drift: (rand() * 2 - 1) * 0.06, bpm: 80 + 50 * rand(), noise: 0.002 + 0.01 * rand() };
}

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const rand = mulberry32(12345);
console.log(`n = ${N} per song\n`);
console.log("song".padEnd(26), "method    median  p90   ≤0.5st  ≤1st   flagged(amb>0.9)  err|unflagged p90");
const all = { template: [], key: [] };
for (const song of songs) {
  const ref = song.reference, tune = (ref.tuning_cents || 0) / 100;
  const res = { template: [], key: [] };
  for (let i = 0; i < N; i++) {
    const truth = -6 + 12 * rand();
    const s = singer(ref.template, rand);
    const x = singMelody(s.notes, { sr: SR, offset: truth + tune, bpm: s.bpm, jitterSt: s.jitter, flat: s.drift, noise: s.noise, seed: 1 + Math.floor(rand() * 1e9) });
    const sc = scoreTrial(trackPitch(x, SR), song, { noiseRms: s.noise });
    for (const m of ["template", "key"]) {
      if (!sc[m]) { res[m].push({ err: 6, amb: 1 }); continue; }
      res[m].push({ err: Math.abs(wrap12(sc[m].deviation - truth)), amb: sc[m].ambiguity });
    }
  }
  for (const m of ["template", "key"]) {
    const e = res[m].map((r) => r.err), ok = res[m].filter((r) => r.amb <= 0.9).map((r) => r.err);
    all[m].push(...res[m]);
    console.log((m === "template" ? song.id : "").padEnd(26), m.padEnd(9), q(e, .5).toFixed(2).padStart(6), q(e, .9).toFixed(2).padStart(5),
      `${Math.round(100 * e.filter((v) => v <= .5).length / e.length)}%`.padStart(7), `${Math.round(100 * e.filter((v) => v <= 1).length / e.length)}%`.padStart(6),
      `${Math.round(100 * (1 - ok.length / e.length))}%`.padStart(12), (ok.length ? q(ok, .9).toFixed(2) : "–").padStart(14));
  }
}
console.log();
for (const m of ["template", "key"]) {
  const e = all[m].map((r) => r.err);
  console.log(`ALL ${m.padEnd(9)} median ${q(e, .5).toFixed(2)}  p90 ${q(e, .9).toFixed(2)}  within 0.5 st ${Math.round(100 * e.filter((v) => v <= .5).length / e.length)}%`);
}
