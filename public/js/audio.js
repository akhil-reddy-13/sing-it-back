// Microphone capture, level metering, and test-tone synthesis.
import { midiToHz } from "./pitch.js";

let ctx = null;
export function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/**
 * Open the microphone with all browser "voice enhancement" turned off
 * (echo cancellation / noise suppression / auto gain can smear pitch).
 */
export async function openMic() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const c = audioCtx();
  const src = c.createMediaStreamSource(stream);
  const analyser = c.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);

  let chunks = [], recording = false, node = null, legacy = null;
  if (c.audioWorklet) {
    await c.audioWorklet.addModule(new URL("./recorder-worklet.js", import.meta.url));
    node = new AudioWorkletNode(c, "recorder-processor");
    node.port.onmessage = (e) => { if (recording) chunks.push(e.data); };
    src.connect(node);
    // keep the graph pulling without making sound
    const mute = c.createGain(); mute.gain.value = 0; node.connect(mute).connect(c.destination);
  } else {
    legacy = c.createScriptProcessor(4096, 1, 1);
    legacy.onaudioprocess = (e) => { if (recording) chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    const mute = c.createGain(); mute.gain.value = 0;
    src.connect(legacy); legacy.connect(mute).connect(c.destination);
  }

  const track = stream.getAudioTracks()[0];
  const tbuf = new Float32Array(analyser.fftSize);
  return {
    sampleRate: c.sampleRate,
    settings: { ...(track.getSettings ? track.getSettings() : {}), label: track.label || "" },
    level() { // current RMS (0..1)
      analyser.getFloatTimeDomainData(tbuf);
      let s = 0; for (let i = 0; i < tbuf.length; i++) s += tbuf[i] * tbuf[i];
      return Math.sqrt(s / tbuf.length);
    },
    start() { chunks = []; recording = true; },
    stop() {
      recording = false;
      const n = chunks.reduce((s, a) => s + a.length, 0), out = new Float32Array(n);
      let o = 0; for (const a of chunks) { out.set(a, o); o += a.length; }
      chunks = [];
      return out;
    },
    close() { stream.getTracks().forEach((t) => t.stop()); try { node?.disconnect(); legacy?.disconnect(); } catch {} },
  };
}

/** Animate a level meter element (width %) until the returned stop() is called. */
export function meter(mic, el, onLevel) {
  let raf = 0, alive = true;
  const tick = () => {
    if (!alive) return;
    const l = mic.level();
    const db = 20 * Math.log10(Math.max(l, 1e-5)); // -100..0
    el.style.width = Math.max(0, Math.min(100, ((db + 60) / 50) * 100)) + "%";
    onLevel?.(l);
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => { alive = false; cancelAnimationFrame(raf); el.style.width = "0%"; };
}

/** Piano-like additive tone (same synthesis as the original Pitch Lab prototype). */
export function pianoTone(midi, dur = 1.0) {
  const c = audioCtx(), t0 = c.currentTime + 0.03, f0 = midiToHz(midi), out = c.createGain();
  out.gain.value = 0.22; out.connect(c.destination);
  for (let k = 1; k <= 9; k++) {
    const fk = f0 * k * Math.sqrt(1 + 0.0004 * k * k);
    if (fk > 16000) break;
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.value = fk;
    const a = Math.pow(0.9, k) / k;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(a, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(Math.max(a * 0.001, 1e-5), t0 + dur);
    o.connect(g).connect(out); o.start(t0); o.stop(t0 + dur + 0.05);
  }
}

/** Noise + random-tone mask so the previous note can't be used as a reference. */
export function maskBurst(dur = 0.9, rand = Math.random) {
  const c = audioCtx(), n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (rand() * 2 - 1) * Math.sin((Math.PI * i) / n) * 0.3;
  for (let j = 0; j < 8; j++) {
    const f = midiToHz(45 + Math.floor(rand() * 42)), s = Math.floor((n * j) / 8), L = Math.floor(n / 8);
    for (let i = 0; i < L; i++) d[s + i] += 0.1 * Math.sin((2 * Math.PI * f * i) / c.sampleRate) * Math.sin((Math.PI * i) / L);
  }
  const src = c.createBufferSource(); src.buffer = buf; src.connect(c.destination); src.start(c.currentTime + 0.02);
}

/** Play a melody template (researcher verification tool only; never during the study). */
export function playTemplate(notes, { bpm = 100, offset = 0 } = {}) {
  const c = audioCtx(), beat = 60 / bpm;
  let t = c.currentTime + 0.1;
  const stops = [];
  for (const n of notes) {
    const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = "sawtooth"; f.type = "lowpass"; f.frequency.value = 2000;
    o.frequency.value = midiToHz(n.midi + offset);
    const d = n.beats * beat;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.02);
    g.gain.setValueAtTime(0.12, t + d * 0.85); g.gain.linearRampToValueAtTime(0, t + d * 0.95);
    o.connect(f).connect(g).connect(c.destination); o.start(t); o.stop(t + d);
    stops.push(o); t += d;
  }
  return () => stops.forEach((o) => { try { o.stop(); } catch {} });
}

/** 16-bit PCM WAV (for optional, separately consented audio upload). */
export function encodeWav(x, sr) {
  const buf = new ArrayBuffer(44 + x.length * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + x.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}
