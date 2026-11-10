// =====================================================================
//  pitch.js — Sing It Back analysis core (no dependencies).
//  Runs identically in the browser and in Node (tests), so every number
//  the app reports can be reproduced from the stored raw pitch track.
//  A line-for-line Python port lives in analysis/pitchlib.py.
//
//  Pipeline:  mic PCM --resample()--> 16 kHz --trackPitch() (YIN)-->
//             f0/aperiodicity/rms per 10 ms --cleanMidi()--> MIDI track
//             --scoreTrial()--> deviation from the original recording,
//             in semitones, folded into [-6, +6) (octave-free).
// =====================================================================

export const ANALYSIS_VERSION = "1.0.0";
export const SR = 16000;        // analysis sample rate (Hz)
export const HOP = 160;         // 10 ms hop
export const WIN = 640;         // 40 ms YIN integration window
export const FMIN = 65;         // ~C2
export const FMAX = 1050;       // ~C6
export const YIN_THRESHOLD = 0.15;

export const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const PC_OF = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);
export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
/** Fold a semitone difference into [-6, 6): octave errors don't count. */
export const wrap12 = (x) => ((((x + 6) % 12) + 12) % 12) - 6;
export const midiToName = (m) => {
  const r = Math.round(m);
  return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
};
/** "C#4", "Eb5", "a3" -> MIDI number (C4 = 60). Returns NaN if unparseable. */
export function parseNote(s) {
  const m = /^\s*([A-Ga-g])([#b♯♭]?)(-?\d)\s*$/.exec(s);
  if (!m) return NaN;
  const acc = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  return 12 * (parseInt(m[3], 10) + 1) + PC_OF[m[1].toUpperCase()] + acc;
}
/** "C", "F#", "Bb" -> pitch class 0..11 */
export function parsePc(s) {
  const n = parseNote(String(s).trim() + "4");
  return Number.isNaN(n) ? NaN : ((n % 12) + 12) % 12;
}

/** Parse "G4:0.75 G4:0.25 A4 G4 C5 B4:2" into [{midi, beats}] (beats default 1). */
export function parseTemplate(text) {
  const notes = [];
  for (const tok of String(text).split(/[\s,]+/).filter(Boolean)) {
    const [n, b] = tok.split(":");
    const midi = parseNote(n);
    if (Number.isNaN(midi)) throw new Error(`Can't read note "${tok}"`);
    notes.push({ midi, beats: b ? parseFloat(b) : 1 });
  }
  return notes;
}
export const templateToText = (notes) =>
  notes.map((n) => midiToName(n.midi) + (n.beats === 1 ? "" : ":" + n.beats)).join(" ");

// ---------- small numeric helpers ----------
export function median(arr) {
  const a = Array.from(arr).filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : 0.5 * (a[h - 1] + a[h]);
}
export function quantile(arr, q) {
  const a = Array.from(arr).filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}
/** Deterministic PRNG so trial orders can be regenerated from the stored seed. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- resampling (deterministic across browsers) ----------
/** Windowed-sinc low-pass + linear interpolation. Good enough for f0 < 1.1 kHz. */
export function resample(x, srIn, srOut = SR) {
  if (srIn === srOut) return Float32Array.from(x);
  const ratio = srOut / srIn;
  const nOut = Math.floor(x.length * ratio);
  const out = new Float32Array(nOut);
  let filt;
  if (ratio < 1) {
    const N = 63, M = (N - 1) / 2, fc = 0.45 * ratio;
    const h = new Float64Array(N);
    let s = 0;
    for (let n = 0; n < N; n++) {
      const t = n - M;
      const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
      h[n] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (N - 1)));
      s += h[n];
    }
    for (let n = 0; n < N; n++) h[n] /= s;
    filt = (i) => {
      let acc = 0;
      for (let k = 0; k < N; k++) {
        const j = i + k - M;
        if (j >= 0 && j < x.length) acc += h[k] * x[j];
      }
      return acc;
    };
  } else {
    filt = (i) => (i >= 0 && i < x.length ? x[i] : 0);
  }
  for (let i = 0; i < nOut; i++) {
    const pos = i / ratio, i0 = Math.floor(pos), fr = pos - i0;
    out[i] = filt(i0) * (1 - fr) + (fr > 0 ? filt(i0 + 1) * fr : 0);
  }
  return out;
}

// ---------- YIN pitch tracker (de Cheveigné & Kawahara, 2002) ----------
/**
 * @param {Float32Array} x mono signal at `sr`
 * @returns {{sr:number, hop:number, f0:Float32Array, ap:Float32Array, rms:Float32Array}}
 *   f0 = best period estimate (Hz) for every frame (even unvoiced ones);
 *   ap = aperiodicity (CMND minimum, 0 = perfectly periodic, 1 = noise);
 *   rms = frame energy. Voicing is decided later, so it can be re-decided offline.
 */
export function trackPitch(x, sr = SR, opts = {}) {
  const hop = opts.hop ?? HOP, W = opts.win ?? WIN;
  const fmin = opts.fmin ?? FMIN, fmax = opts.fmax ?? FMAX, thr = opts.threshold ?? YIN_THRESHOLD;
  const tauMin = Math.max(2, Math.floor(sr / fmax)), tauMax = Math.ceil(sr / fmin);
  const nFrames = Math.max(0, Math.floor((x.length - W - tauMax - 2) / hop) + 1);
  const f0 = new Float32Array(nFrames), ap = new Float32Array(nFrames), rms = new Float32Array(nFrames);
  const d = new Float64Array(tauMax + 2);
  for (let i = 0; i < nFrames; i++) {
    const s = i * hop;
    let e = 0;
    for (let j = 0; j < W; j++) e += x[s + j] * x[s + j];
    rms[i] = Math.sqrt(e / W);
    if (e < 1e-12) { f0[i] = 0; ap[i] = 1; continue; }
    // difference function
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let acc = 0;
      for (let j = 0; j < W; j++) {
        const df = x[s + j] - x[s + j + tau];
        acc += df * df;
      }
      d[tau] = acc;
    }
    // cumulative mean normalized difference
    d[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      run += d[tau];
      d[tau] = run > 0 ? (d[tau] * tau) / run : 1;
    }
    // absolute threshold, then walk to the local minimum
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (d[t] < thr) {
        while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      let best = Infinity;
      for (let t = tauMin; t <= tauMax; t++) if (d[t] < best) { best = d[t]; tau = t; }
    }
    // parabolic interpolation
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const den = a - 2 * b + c;
    const shift = den > 1e-12 ? (0.5 * (a - c)) / den : 0;
    f0[i] = sr / (tau + Math.max(-1, Math.min(1, shift)));
    ap[i] = Math.max(0, Math.min(1, b));
  }
  return { sr, hop, f0, ap, rms };
}

/**
 * Voiced/unvoiced decision. noiseRms = room-noise level measured during the mic check.
 * The energy gate is capped at 30% of the recording's own loud (95th-percentile) level,
 * so a contaminated noise measurement can never silence a real performance.
 */
export function voicing(track, { apMax = 0.25, noiseRms = 0, minRms = 0.0015 } = {}) {
  const loud = quantile(track.rms, 0.95);
  const gate = Math.max(minRms, Math.min(2.5 * (noiseRms || 0), Number.isFinite(loud) ? 0.3 * loud : Infinity));
  const v = new Uint8Array(track.f0.length);
  for (let i = 0; i < v.length; i++) v[i] = track.ap[i] <= apMax && track.rms[i] >= gate && track.f0[i] > 0 ? 1 : 0;
  return v;
}

/** MIDI track with NaN for unvoiced frames; 5-frame median filter; drop blips < 50 ms. */
export function cleanMidi(track, vopts = {}) {
  const v = voicing(track, vopts);
  const n = v.length, raw = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) if (v[i]) raw[i] = hzToMidi(track.f0[i]);
  const m = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(raw[i])) continue;
    const w = [];
    for (let k = -2; k <= 2; k++) if (i + k >= 0 && i + k < n && Number.isFinite(raw[i + k])) w.push(raw[i + k]);
    m[i] = median(w);
  }
  // remove voiced runs shorter than 5 frames
  let i = 0;
  while (i < n) {
    if (!Number.isFinite(m[i])) { i++; continue; }
    let j = i;
    while (j < n && Number.isFinite(m[j])) j++;
    if (j - i < 5) for (let k = i; k < j; k++) m[k] = NaN;
    i = j;
  }
  return m;
}

/** Levitin-style measure: the first note held steadily for >= minFrames (default 150 ms). */
export function firstStableNote(m, { minFrames = 15, tol = 0.6, hopSec = HOP / SR } = {}) {
  const n = m.length;
  for (let i = 0; i + minFrames <= n; i++) {
    let ok = true;
    for (let k = i; k < i + minFrames; k++) if (!Number.isFinite(m[k])) { ok = false; break; }
    if (!ok) continue;
    const med = median(m.subarray(i, i + minFrames));
    let maxDev = 0;
    for (let k = i; k < i + minFrames; k++) maxDev = Math.max(maxDev, Math.abs(m[k] - med));
    if (maxDev > tol) continue;
    let j = i + minFrames;
    while (j < n && Number.isFinite(m[j]) && Math.abs(m[j] - med) <= tol) j++;
    return { midi: median(m.subarray(i, j)), start_sec: i * hopSec, dur_sec: (j - i) * hopSec };
  }
  return null;
}

/** Sung contour at 20 Hz (median of each 50 ms chunk with >= 3 voiced frames). */
export function contour(m, chunk = 5) {
  const q = [];
  for (let i = 0; i + chunk <= m.length; i += chunk) {
    const w = [];
    for (let k = i; k < i + chunk; k++) if (Number.isFinite(m[k])) w.push(m[k]);
    if (w.length >= 3) q.push(median(w));
  }
  return q;
}

function expandTemplate(notes, perBeat = 2) {
  const r = [];
  for (const n of notes) for (let k = 0; k < Math.max(1, Math.round(n.beats * perBeat)); k++) r.push(n.midi);
  return r;
}

/** Subsequence DTW: whole sung contour vs. any stretch of the template, at transposition t. */
export function dtwCost(Q, R, t, cap = 2) {
  const N = Q.length, M = R.length;
  let prev = new Float64Array(M), cur = new Float64Array(M);
  const c = (q, r) => Math.min(cap, Math.abs(wrap12(q - t - r)));
  for (let j = 0; j < M; j++) prev[j] = c(Q[0], R[j]);
  for (let i = 1; i < N; i++) {
    cur[0] = c(Q[i], R[0]) + prev[0];
    for (let j = 1; j < M; j++) cur[j] = c(Q[i], R[j]) + Math.min(prev[j], prev[j - 1], cur[j - 1]);
    [prev, cur] = [cur, prev];
  }
  let best = Infinity;
  for (let j = 0; j < M; j++) best = Math.min(best, prev[j]);
  return best / N;
}

/** Best transposition between the sung melody and the reference template. */
export function scoreTemplate(m, notes, tuningCents = 0) {
  const Q = contour(m);
  if (Q.length < 20 || !notes?.length) return null;
  // Template repeated 3x so people who repeat the chorus (or start mid-way and loop
  // back to the top) can still be aligned as one continuous path.
  const one = expandTemplate(notes).map((x) => x + tuningCents / 100);
  const R = [...one, ...one, ...one];
  const coarse = [];
  for (let k = 0; k < 48; k++) { const t = -6 + k * 0.25; coarse.push({ t, cost: dtwCost(Q, R, t) }); }
  let bi = 0;
  coarse.forEach((o, k) => { if (o.cost < coarse[bi].cost) bi = k; });
  let best = coarse[bi];
  for (let t = coarse[bi].t - 0.25; t <= coarse[bi].t + 0.25 + 1e-9; t += 0.02) {
    const cost = dtwCost(Q, R, t);
    if (cost < best.cost) best = { t, cost };
  }
  const rivals = coarse.filter((o) => Math.abs(wrap12(o.t - best.t)) >= 1.5).map((o) => o.cost);
  const second = Math.min(...rivals);
  const tmplMed = median(R);
  return {
    deviation: +wrap12(best.t).toFixed(3),
    cost: +best.cost.toFixed(4),
    ambiguity: +(best.cost / Math.max(second, 1e-9)).toFixed(3), // ~1 = ambiguous, small = clear
    octave: Math.round((median(Q) - (tmplMed + best.t)) / 12),
  };
}

// Krumhansl & Kessler (1982) key profiles
const KK = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};
function pearson(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}
/** Template-free fallback: which tonic (in 0.1-semitone steps) best fits the sung pitch distribution? */
export function scoreKey(m, tonicPc, mode = "major", tuningCents = 0) {
  const B = 120, sigma = 0.3;
  const h = new Float64Array(B);
  let count = 0;
  for (const x of m) {
    if (!Number.isFinite(x)) continue;
    const pc = ((x % 12) + 12) % 12;
    for (let b = 0; b < B; b++) { const dd = wrap12(b / 10 - pc); h[b] += Math.exp(-(dd * dd) / (2 * sigma * sigma)); }
    count++;
  }
  if (count < 200) return null;
  const prof = KK[mode] || KK.major;
  const base = new Float64Array(B);
  for (let b = 0; b < B; b++) for (let k = 0; k < 12; k++) { const dd = wrap12(b / 10 - k); base[b] += prof[k] * Math.exp(-(dd * dd) / (2 * sigma * sigma)); }
  const r = [];
  const shifted = new Float64Array(B);
  for (let s = 0; s < B; s++) {
    for (let b = 0; b < B; b++) shifted[b] = base[(b - s + B) % B];
    r.push(pearson(h, shifted));
  }
  let bs = 0;
  for (let s = 1; s < B; s++) if (r[s] > r[bs]) bs = s;
  let r2 = -1;
  for (let s = 0; s < B; s++) if (Math.abs(wrap12((s - bs) / 10)) >= 1.5) r2 = Math.max(r2, r[s]);
  return {
    deviation: +wrap12(bs / 10 - (tonicPc + tuningCents / 100)).toFixed(3),
    r: +r[bs].toFixed(4),
    ambiguity: +(r[bs] > 0 ? Math.max(0, r2) / r[bs] : 1).toFixed(3),
  };
}

/**
 * Score one singing trial against a song entry from songs.json.
 * Primary measure: template alignment when the reference melody is available,
 * otherwise the key-profile estimate. All three measures are always reported.
 */
export function scoreTrial(track, song, vopts = {}) {
  const m = cleanMidi(track, vopts);
  const hopSec = track.hop / track.sr;
  let voiced = 0;
  for (const x of m) if (Number.isFinite(x)) voiced++;
  const out = {
    analysis_version: ANALYSIS_VERSION,
    voiced_sec: +(voiced * hopSec).toFixed(2),
    median_midi: Number.isFinite(median(m)) ? +median(m).toFixed(2) : null,
    p05_midi: voiced ? +quantile(m, 0.05).toFixed(2) : null,
    p95_midi: voiced ? +quantile(m, 0.95).toFixed(2) : null,
    anchor: null, template: null, key: null, primary: null,
  };
  const ref = song?.reference;
  if (!ref || voiced < 100) return out;
  const tune = ref.tuning_cents || 0;
  const first = firstStableNote(m, { hopSec });
  const anchorMidi = ref.template?.length ? ref.template[0].midi : Number.isFinite(parseNote(ref.anchor_note ?? "")) ? parseNote(ref.anchor_note) : null;
  if (first) {
    out.anchor = { sung_midi: +first.midi.toFixed(2), start_sec: +first.start_sec.toFixed(2) };
    if (anchorMidi != null) out.anchor.deviation = +wrap12(first.midi - (anchorMidi + tune / 100)).toFixed(3);
  }
  if (ref.template?.length) out.template = scoreTemplate(m, ref.template, tune);
  const tonic = parsePc(ref.tonic ?? "");
  if (!Number.isNaN(tonic)) out.key = scoreKey(m, tonic, ref.mode, tune);
  if (out.template) out.primary = { method: "template", deviation: out.template.deviation };
  else if (out.key) out.primary = { method: "key", deviation: out.key.deviation };
  return out;
}

/** Compact, JSON-friendly copy of a pitch track for upload (10 ms frames). */
export function packTrack(track) {
  const r = (a, d) => Array.from(a, (v) => +v.toFixed(d));
  return { sr: track.sr, hop: track.hop, f0: r(track.f0, 1), ap: r(track.ap, 3), rms: r(track.rms, 5) };
}
export function unpackTrack(p) {
  return { sr: p.sr, hop: p.hop, f0: Float32Array.from(p.f0), ap: Float32Array.from(p.ap), rms: Float32Array.from(p.rms) };
}
