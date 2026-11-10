// Synthetic "singer" used by the tests: harmonic voice with vibrato,
// pitch scoops, jitter, breaths between notes and background noise.
import { midiToHz, mulberry32 } from "../public/js/pitch.js";

export function singMelody(notes, {
  sr = 48000, offset = 0, bpm = 100, vibratoSt = 0.3, vibratoHz = 5.5, scoopSt = 0.8,
  noise = 0.01, jitterSt = 0.08, gapSec = 0.04, seed = 1, lead = 0.4, flat = 0,
} = {}) {
  const rand = mulberry32(seed);
  const beat = 60 / bpm;
  const total = lead + notes.reduce((s, n) => s + n.beats * beat, 0) + 0.5;
  const x = new Float32Array(Math.ceil(total * sr));
  let t = lead, phase = 0;
  for (const n of notes) {
    const dur = n.beats * beat, i0 = Math.floor(t * sr), i1 = Math.floor((t + dur - gapSec) * sr);
    const err = (rand() * 2 - 1) * jitterSt; // per-note intonation error
    for (let i = i0; i < i1 && i < x.length; i++) {
      const tt = (i - i0) / sr;
      const scoop = -scoopSt * Math.exp(-tt / 0.05);
      const vib = vibratoSt * Math.sin(2 * Math.PI * vibratoHz * tt) * Math.min(1, tt / 0.3);
      const f = midiToHz(n.midi + offset + err + scoop + vib + flat * tt);
      phase += (2 * Math.PI * f) / sr;
      const env = Math.min(1, tt / 0.02, (i1 - i) / sr / 0.03);
      let s = 0;
      for (let k = 1; k <= 8; k++) if (f * k < sr / 2) s += Math.sin(k * phase) / k ** 1.2;
      x[i] = 0.2 * env * s;
    }
    t += dur;
  }
  for (let i = 0; i < x.length; i++) x[i] += noise * (rand() * 2 - 1);
  return x;
}
