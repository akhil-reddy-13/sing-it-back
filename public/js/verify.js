// Researcher tool: verify reference songs and test the scorer.
import { parseTemplate, templateToText, parsePc, resample, trackPitch, scoreTrial, cleanMidi, midiToName, SR, NOTE_NAMES, wrap12 } from "./pitch.js";
import { playTemplate, openMic, meter, audioCtx } from "./audio.js";
import { midiToHz } from "./pitch.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let data, current = null, stopPlay = () => {}, dirty = false, mic = null;

async function load() {
  data = await (await fetch("songs.json", { cache: "no-store" })).json();
  renderList();
  $("#t_song").innerHTML = data.songs.map((s) => `<option value="${s.id}">${esc(s.title)}${s.artist ? " — " + esc(s.artist) : ""}</option>`).join("");
}

function renderList() {
  $("#list tbody").innerHTML = data.songs.map((s) => {
    const r = s.reference || {};
    return `<tr><td><strong>${esc(s.title)}</strong><br><span class="muted">${esc(s.artist)} ${s.role === "control" ? "(control)" : ""}</span></td>
      <td>${esc(r.tonic)} ${esc(r.mode)}</td><td>${r.tuning_cents ?? 0}¢</td>
      <td>${r.template?.length ? r.template.length + " notes" : "<span class='muted'>none</span>"}</td>
      <td><span class="pill ${r.verified ? "ok" : "no"}">${r.verified ? "verified" : "unverified"}</span></td>
      <td><button class="btn ghost small" data-edit="${s.id}">Edit</button></td></tr>`;
  }).join("");
  document.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => edit(b.dataset.edit)));
  $("#dirty").textContent = dirty ? "Unsaved changes: download and commit songs.json." : "";
}

function edit(id) {
  current = data.songs.find((s) => s.id === id);
  const r = current.reference;
  $("#editor").classList.remove("hidden");
  $("#ed_title").textContent = `${current.title} — ${current.artist || "traditional"}`;
  $("#ed_tonic").value = r.tonic || ""; $("#ed_mode").value = r.mode || "major"; $("#ed_tune").value = r.tuning_cents || 0;
  $("#ed_tmpl").value = r.template ? templateToText(r.template) : "";
  $("#ed_src").value = r.source || ""; $("#ed_ver").checked = !!r.verified; $("#ed_msg").textContent = "";
  $("#editor").scrollIntoView({ behavior: "smooth" });
}

function readEditor() {
  const tonic = $("#ed_tonic").value.trim();
  if (Number.isNaN(parsePc(tonic))) throw new Error("Tonic must be a note name like C, F#, Bb");
  const txt = $("#ed_tmpl").value.trim();
  return { tonic, mode: $("#ed_mode").value, tuning_cents: +$("#ed_tune").value || 0, template: txt ? parseTemplate(txt) : null };
}

$("#play").onclick = () => {
  try {
    const r = readEditor();
    if (!r.template) { $("#ed_msg").textContent = "Enter a melody first."; return; }
    stopPlay(); stopPlay = playTemplate(r.template, { bpm: +$("#ed_bpm").value || 100, offset: r.tuning_cents / 100 });
  } catch (e) { $("#ed_msg").textContent = e.message; }
};
$("#drone").onclick = () => {
  try {
    const r = readEditor(), c = audioCtx(), o = c.createOscillator(), g = c.createGain();
    o.frequency.value = midiToHz(48 + parsePc(r.tonic) + r.tuning_cents / 100); o.type = "triangle";
    g.gain.value = 0.15; o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + 6);
    stopPlay(); stopPlay = () => { try { o.stop(); } catch {} };
  } catch (e) { $("#ed_msg").textContent = e.message; }
};
$("#stopplay").onclick = () => stopPlay();
$("#save").onclick = () => {
  try {
    const r = readEditor();
    Object.assign(current.reference, r, { source: $("#ed_src").value.trim(), verified: $("#ed_ver").checked, anchor_note: r.template ? midiToName(r.template[0].midi) : current.reference.anchor_note });
    dirty = true; renderList(); $("#ed_msg").textContent = "Saved in this page. Download songs.json to keep it.";
  } catch (e) { $("#ed_msg").textContent = e.message; }
};
$("#dl").onclick = () => {
  const allVerified = data.songs.every((s) => s.reference?.verified);
  if (allVerified && data.version.includes("unverified")) data.version = data.version.replace("-unverified", "");
  data.updated = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = "songs.json"; a.click(); dirty = false; renderList();
};

// ---------- scorer test ----------
$("#t_rec").onclick = async () => {
  mic = mic || (await openMic());
  const stopMeter = meter(mic, $("#lvl"));
  $("#t_rec").classList.add("hidden"); $("#stop").classList.remove("hidden");
  mic.start();
  await new Promise((res) => ($("#stop").onclick = res));
  const raw = mic.stop(); stopMeter();
  $("#stop").classList.add("hidden"); $("#t_rec").classList.remove("hidden");
  const song = data.songs.find((s) => s.id === $("#t_song").value);
  const x = resample(raw, mic.sampleRate, SR), tr = trackPitch(x, SR);
  const t0 = performance.now(), sc = scoreTrial(tr, song), ms = performance.now() - t0;
  $("#t_out").textContent = JSON.stringify(sc, null, 2) + `\n\n(analysis ${ms.toFixed(0)} ms, input ${mic.sampleRate} Hz)`;
  draw(cleanMidi(tr), song, sc);
};

function draw(m, song, sc) {
  const cv = $("#cv"), g = cv.getContext("2d"), W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  const fin = Array.from(m).filter(Number.isFinite);
  if (!fin.length) return;
  const lo = Math.floor(Math.min(...fin)) - 3, hi = Math.ceil(Math.max(...fin)) + 3;
  const y = (v) => H - ((v - lo) / (hi - lo)) * H;
  g.font = "22px system-ui"; g.fillStyle = "#888"; g.strokeStyle = "rgba(128,128,128,.25)";
  for (let k = lo; k <= hi; k++) {
    g.beginPath(); g.moveTo(0, y(k)); g.lineTo(W, y(k)); g.stroke();
    if (k % 12 === 0 || k % 12 === 7) g.fillText(midiToName(k), 6, y(k) - 4);
  }
  g.fillStyle = "#b83a4b";
  for (let i = 0; i < m.length; i++) if (Number.isFinite(m[i])) g.fillRect((i / m.length) * W, y(m[i]) - 2, Math.max(2, W / m.length), 4);
  // template overlay at the best transposition, folded to the octave the singer used
  const tm = song.reference?.template;
  if (tm && sc.template) {
    const shift = sc.template.deviation + 12 * sc.template.octave + (song.reference.tuning_cents || 0) / 100;
    const total = tm.reduce((s, n) => s + n.beats, 0);
    let t = 0;
    g.fillStyle = "rgba(23,94,84,.55)";
    for (const n of tm) { g.fillRect((t / total) * W, y(n.midi + shift) - 6, (n.beats / total) * W - 4, 12); t += n.beats; }
    g.fillText(`template shifted ${sc.template.deviation >= 0 ? "+" : ""}${sc.template.deviation} st (green; time not aligned)`, W - 620, 30);
  }
}

window.onbeforeunload = (e) => { if (dirty) { e.preventDefault(); return ""; } };
load();
