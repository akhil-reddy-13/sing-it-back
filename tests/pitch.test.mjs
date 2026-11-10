import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resample, trackPitch, cleanMidi, scoreTrial, scoreTemplate, scoreKey, firstStableNote,
  wrap12, parseNote, parsePc, parseTemplate, templateToText, hzToMidi, median, packTrack, unpackTrack, SR,
} from "../public/js/pitch.js";
import { singMelody } from "./synth.mjs";

const songs = JSON.parse(readFileSync(new URL("../public/songs.json", import.meta.url)));
const HB = songs.songs.find((s) => s.id === "happy_birthday").reference.template;

const analyze = (x, sr = 48000) => trackPitch(resample(x, sr, SR), SR);

test("note parsing and folding", () => {
  assert.equal(parseNote("C4"), 60);
  assert.equal(parseNote("A4"), 69);
  assert.equal(parseNote("Bb3"), 58);
  assert.equal(parseNote("F#5"), 78);
  assert.ok(Number.isNaN(parseNote("H4")));
  assert.equal(parsePc("Eb"), 3);
  assert.equal(parsePc("C#"), 1);
  assert.equal(wrap12(7), -5);
  assert.equal(wrap12(-6), -6);
  assert.equal(wrap12(12.5), 0.5);
  const t = parseTemplate("G4:0.75 G4:0.25 A4 C5:2");
  assert.deepEqual(t.map((n) => n.midi), [67, 67, 69, 72]);
  assert.equal(templateToText(t), "G4:0.75 G4:0.25 A4 C5:2");
});

test("YIN tracks steady tones within 5 cents across the range", () => {
  for (const f of [82.4, 130.8, 220, 440, 880]) {
    const sr = 44100, x = new Float32Array(sr);
    for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * f * i) / sr) + 0.1 * Math.sin((4 * Math.PI * f * i) / sr);
    const tr = analyze(x, sr);
    const est = median(Array.from(tr.f0).slice(10, -10));
    assert.ok(Math.abs(hzToMidi(est) - hzToMidi(f)) < 0.05, `f=${f} est=${est}`);
  }
});

test("silence and noise are unvoiced", () => {
  const sr = 48000, x = new Float32Array(sr);
  let seed = 3;
  for (let i = 0; i < x.length; i++) { seed = (seed * 16807) % 2147483647; x[i] = 0.05 * (seed / 2147483647 - 0.5); }
  const m = cleanMidi(analyze(x, sr));
  const voiced = Array.from(m).filter(Number.isFinite).length;
  assert.ok(voiced < 10, `voiced frames in noise: ${voiced}`);
});

test("template scoring recovers known transpositions (incl. octave-down singers)", () => {
  const cases = [0, 1.5, -2.3, 4, -5.5, 0.4, 3 - 12, -1 - 12];
  for (const [k, off] of cases.entries()) {
    const x = singMelody(HB, { offset: off, seed: k + 1, bpm: 90 + 10 * k });
    const sc = scoreTemplate(cleanMidi(analyze(x)), HB);
    assert.ok(sc, "scored");
    const err = Math.abs(wrap12(sc.deviation - off));
    assert.ok(err < 0.2, `offset ${off}: got ${sc.deviation} (err ${err.toFixed(2)})`);
    assert.ok(sc.ambiguity < 0.8, `clear minimum expected, ambiguity ${sc.ambiguity}`);
  }
});

test("template scoring works when only part of the melody is sung", () => {
  const part = HB.slice(6, 19);
  const x = singMelody(part, { offset: -3.2, seed: 9 });
  const sc = scoreTemplate(cleanMidi(analyze(x)), HB);
  assert.ok(Math.abs(wrap12(sc.deviation + 3.2)) < 0.25, `got ${sc.deviation}`);
});

test("template scoring handles a repeated chorus that wraps from the end back to the start", () => {
  const wrapped = [...HB.slice(13), ...HB, ...HB.slice(0, 8)];
  const x = singMelody(wrapped, { offset: 2, seed: 12, bpm: 120 });
  const sc = scoreTemplate(cleanMidi(analyze(x)), HB);
  assert.ok(Math.abs(wrap12(sc.deviation - 2)) < 0.2, `got ${sc.deviation}`);
});

test("key-profile fallback lands near the right tonic", () => {
  // Happy Birthday is in C major; sing it 2 semitones up -> D major
  const x = singMelody(HB, { offset: 2, seed: 4 });
  const sc = scoreKey(cleanMidi(analyze(x)), 0, "major");
  assert.ok(sc, "scored");
  assert.ok(Math.abs(wrap12(sc.deviation - 2)) < 0.6, `got ${sc.deviation}`);
});

test("first stable note (Levitin-style anchor)", () => {
  const x = singMelody(HB, { offset: 1, seed: 2, scoopSt: 1.2 });
  const first = firstStableNote(cleanMidi(analyze(x)));
  assert.ok(Math.abs(first.midi - 68) < 0.3, `got ${first.midi}`);
});

test("scoreTrial end to end, and pack/unpack round trip is lossless enough", () => {
  const song = { reference: { tonic: "C", mode: "major", tuning_cents: 0, template: HB } };
  const tr = analyze(singMelody(HB, { offset: -1.7, seed: 11 }));
  const a = scoreTrial(tr, song);
  const b = scoreTrial(unpackTrack(JSON.parse(JSON.stringify(packTrack(tr)))), song);
  assert.equal(a.primary.method, "template");
  assert.ok(Math.abs(a.primary.deviation + 1.7) < 0.2);
  assert.ok(Math.abs(a.primary.deviation - b.primary.deviation) < 0.03);
  assert.ok(a.voiced_sec > 5);
});

test("tuning offset of the recording is respected", () => {
  const song = { reference: { tonic: "C", mode: "major", tuning_cents: 30, template: HB } };
  // singer reproduces the (30-cent sharp) recording exactly
  const tr = analyze(singMelody(HB, { offset: 0.3, seed: 5 }));
  assert.ok(Math.abs(scoreTrial(tr, song).primary.deviation) < 0.15);
});

test("an over-estimated noise floor cannot gate out a real performance", () => {
  const tr = analyze(singMelody(HB, { offset: 1, seed: 6 }));
  const loudRms = Math.max(...tr.rms);
  const sc = scoreTrial(tr, { reference: { tonic: "C", mode: "major", template: HB } }, { noiseRms: loudRms });
  assert.ok(sc.voiced_sec > 5, `voiced ${sc.voiced_sec}`);
  assert.ok(Math.abs(sc.primary.deviation - 1) < 0.2);
});

test("songs.json is well-formed", () => {
  const ids = new Set();
  for (const s of songs.songs) {
    assert.ok(!ids.has(s.id), "unique id " + s.id); ids.add(s.id);
    assert.ok(["target", "control"].includes(s.role));
    assert.ok(s.title && s.artist !== undefined && s.prompt);
    if (s.role === "target") {
      assert.ok(!Number.isNaN(parsePc(s.reference.tonic)), s.id + " tonic");
      assert.ok(["major", "minor"].includes(s.reference.mode), s.id + " mode");
    }
    if (s.reference?.template) for (const n of s.reference.template) assert.ok(Number.isFinite(n.midi) && n.beats > 0);
  }
});
