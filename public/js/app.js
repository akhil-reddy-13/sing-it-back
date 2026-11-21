// =====================================================================
//  Sing It Back — participant flow (v2, ~5 minutes)
//  welcome → consent → mic check → pick songs → sing (3 targets, then
//  Happy Birthday) → name 12 notes → 6 quick questions → results
//
//  Order matters: no external tone is played until all singing is done,
//  so nothing in the study can give people a reference pitch.
//  Kept from v1 because the confirmatory tests need them (PROTOCOL §2):
//    H1/H1b  ≥2 target songs per person, scored against the recording key
//    H2a/H2b language background + note naming
//    exclusions: "didn't know it" flag, hearing, music heard during study
// =====================================================================
import { resample, trackPitch, scoreTrial, packTrack, cleanMidi, quantile, mulberry32, shuffle, NOTE_NAMES, SR, ANALYSIS_VERSION } from "./pitch.js";
import { openMic, meter, pianoTone, maskBurst, encodeWav } from "./audio.js";
import { getConfig, send, uploadAudio, log } from "./api.js";

const APP_VERSION = "0.2.0";
const FLOW_VERSION = "short_v2";
const MAX_SONGS = 3;
const AMBIGUITY_MAX = 0.9; // same thresholds as analysis/analyze.py
const MARGIN_MIN = 0;     // this song must fit better than every other song (wrong-song check; tests/benchmark_gates.mjs: 100% right kept, 1% wrong let through)
const COST_MAX = 0.6;      // mean |st| misfit (analysis 1.1). PROVISIONAL: synthetic right ~0.15, real right 0.34–0.54 (4 pilot takes). Recalibrate on pilot data.
// Only melody-template scoring is accurate (tests/benchmark_scorer.mjs: 99% within 0.5 st;
// the key-profile fallback confuses keys a 4th/5th apart ~28% of the time). So songs
// without a template are never offered, and only confident template fits are shown.
const scorable = (song) => !!song.reference?.template?.length;
const reliable = (t) => t.scores?.primary?.method === "template" && t.scores.template.ambiguity <= AMBIGUITY_MAX && t.scores.template.cost <= COST_MAX
  && (t.scores.specificity == null || t.scores.specificity.margin >= MARGIN_MIN);
const N_NAMING = 12;
const STEPS = ["", "Consent", "Mic", "Songs", "Sing", "Notes", "About you", "Results"];

const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtTime = (s) => `0:${String(Math.floor(s)).padStart(2, "0")}`;
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15; return (c === "x" ? r : (r & 3) | 8).toString(16);
}));

const S = {
  id: uuid(), app_version: APP_VERSION, analysis_version: ANALYSIS_VERSION,
  seed: crypto.getRandomValues(new Uint32Array(1))[0],
  collecting: false, mode: "offline", consent: null, songs: null, songsVersion: null,
  mic: null, noiseRms: 0, plan: [], trials: [], naming: [], step: 0,
};
const rand = mulberry32(S.seed);

function progress(step, sub = "") {
  S.step = step;
  $("#progress").style.width = Math.round((100 * step) / (STEPS.length - 1)) + "%";
  $("#stepLabel").textContent = step > 0 && step < STEPS.length - 1 ? `${STEPS[step]}${sub ? " · " + sub : ""}` : "";
}
function screen(html) { app.innerHTML = `<section class="screen">${html}</section>`; window.scrollTo(0, 0); app.focus?.({ preventScroll: true }); }

// ---------------------------------------------------------------- recording
const recorderHTML = (hint = "Tap to record") => `
  <div class="recorder">
    <button class="recbtn" id="rec" aria-label="Start recording"><span class="ic"></span></button>
    <div class="meter" aria-hidden="true"><div id="lvl"></div></div>
    <div class="rechint" id="timer">${hint}</div>
  </div>`;

/** Wire up #rec: first tap starts, second tap (after minSec) stops; auto-stops at maxSec. */
function recordWithButton({ maxSec, minSec = 2, onStart } = {}) {
  return new Promise((resolve) => {
    const btn = $("#rec"), timer = $("#timer");
    const stopMeter = meter(S.mic, $("#lvl"));
    btn.onclick = () => {
      S.mic.start();
      const t0 = performance.now();
      let finished = false;
      btn.classList.add("on"); btn.setAttribute("aria-label", "Stop recording");
      timer.textContent = "0:00";
      onStart?.();
      const finish = () => {
        if (finished) return; finished = true;
        clearInterval(iv); stopMeter();
        btn.classList.remove("on"); btn.disabled = true;
        btn.closest(".recorder").classList.add("done");
        timer.textContent = `Recorded · ${fmtTime((performance.now() - t0) / 1000)}`;
        const raw = S.mic.stop();
        resolve({ raw, sr: S.mic.sampleRate, sec: raw.length / S.mic.sampleRate });
      };
      const iv = setInterval(() => {
        const s = (performance.now() - t0) / 1000;
        timer.textContent = s < minSec ? fmtTime(s) : `${fmtTime(s)} · tap to stop`;
        if (s >= maxSec) finish();
      }, 100);
      btn.onclick = () => { if ((performance.now() - t0) / 1000 >= minSec) finish(); };
    };
  });
}
function analyze(raw, sr) {
  const x = resample(raw, sr, SR);
  return { x, track: trackPitch(x, SR) };
}
/** RMS of 20 ms frames, sorted (used to estimate the noise floor from the pauses in one take). */
function frameRms(x, n = 320) {
  const out = [];
  for (let i = 0; i + n <= x.length; i += n) { let s = 0; for (let j = i; j < i + n; j++) s += x[j] * x[j]; out.push(Math.sqrt(s / n)); }
  return out.sort((a, b) => a - b);
}

// ---------------------------------------------------------------- 0 welcome
async function welcome() {
  progress(0);
  const cfg = await getConfig();
  S.collecting = !!cfg.collecting; S.mode = cfg.mode; S.irb = cfg.irb_protocol; S.audioEnabled = !!cfg.audio;
  const sj = await (await fetch("songs.json", { cache: "no-store" })).json();
  S.songs = sj.songs; S.songsVersion = sj.version;
  const supported = !!(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
  if (!S.collecting) $("#banner").innerHTML = `<div class="banner">Preview mode · nothing is saved</div>`;
  screen(`
    <p class="eyebrow">A 5-minute Stanford music study</p>
    <h1>Can you sing a song in its original key?</h1>
    <p class="lede">Most people can't name a note, but many remember exactly how high their favorite songs are. Let's find out if you do.</p>
    <ol class="plan">
      <li><span class="num">1</span><div><b>Sing 4 short clips</b><span>Songs you know by heart. Humming is fine, and so is off-key.</span></div></li>
      <li><span class="num">2</span><div><b>Guess 12 notes</b><span>Almost nobody gets these, so just guess.</span></div></li>
      <li><span class="num">3</span><div><b>Answer 6 quick questions</b><span>Then see how you did.</span></div></li>
    </ol>
    <p class="note">You'll need a microphone and somewhere you're comfortable singing. Please <b>don't play any music</b> until you're done.</p>
    ${supported ? `<div class="actions"><button class="btn" id="go">Let's start</button></div>`
                : `<p class="warn">This browser can't record audio. Please open the page in a recent version of Chrome, Safari, Edge or Firefox.</p>`}`);
  $("#go")?.addEventListener("click", consent);
}

// ---------------------------------------------------------------- 1 consent
async function consent() {
  progress(1);
  let text = "";
  try { text = await (await fetch("consent.html", { cache: "no-store" })).text(); } catch { text = "<p>Consent text could not be loaded.</p>"; }
  screen(`
    <h2>Before we begin</h2>
    <div class="consent">${text}</div>
    <label class="check"><input type="checkbox" id="c_ok"><span>I'm 18 or older, I've read the information above, and I agree to take part.</span></label>
    ${S.audioEnabled ? `<label class="check optional"><input type="checkbox" id="c_audio"><span><b>Optional:</b> you may also keep the audio of my singing for research. If unchecked, only pitch measurements are saved.</span></label>` : ""}
    <div class="actions"><button class="btn" id="go" disabled>Continue</button></div>`);
  $("#c_ok").onchange = () => { $("#go").disabled = !$("#c_ok").checked; };
  $("#go").onclick = () => {
    S.consent = { adult: true, agree: true, audio: !!$("#c_audio")?.checked, time: new Date().toISOString() };
    send(S, "session_start", {
      seed: S.seed, flow_version: FLOW_VERSION, analysis_version: ANALYSIS_VERSION, songs_version: S.songsVersion, mode: S.mode, irb_protocol: S.irb ?? null,
      consent: S.consent, referrer: document.referrer || null, url_params: Object.fromEntries(new URLSearchParams(location.search)),
      device: { ua: navigator.userAgent, lang: navigator.language, langs: navigator.languages, screen: [window.screen.width, window.screen.height], tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
    });
    micCheck();
  };
}

// ---------------------------------------------------------------- 2 mic check
async function micCheck() {
  progress(2);
  screen(`
    <h2>Quick mic check</h2>
    <p>Your browser will ask to use the microphone. Nothing is recorded until you tap the button.</p>
    <p id="msg" class="muted"></p>
    <div class="actions"><button class="btn" id="go">Allow microphone</button></div>`);
  $("#go").onclick = async () => {
    try { S.mic = S.mic || (await openMic()); }
    catch (e) { $("#msg").innerHTML = `<span class="warn">We couldn't open the microphone (${esc(e.name || e.message)}). Check your browser's site permissions and try again.</span>`; return; }
    micTest();
  };
}
async function micTest() {
  screen(`
    <h2>Quick mic check</h2>
    <p>Tap the button, pause for a second, then say <b>“testing, one, two, three.”</b></p>
    ${recorderHTML()}
    <p id="msg" class="center muted"></p>
    <div class="actions center hidden" id="after"></div>`);
  const take = await recordWithButton({ maxSec: 4, minSec: 2 });
  const { x, track } = analyze(take.raw, take.sr);
  const fr = frameRms(x.subarray(Math.floor(0.15 * SR)));
  const floor = Math.max(quantile(fr, 0.1) || 0, 1e-6), loud = Math.max(quantile(fr, 0.9) || 0, 1e-6);
  S.noiseRms = floor;
  const snr = 20 * Math.log10(loud / floor);
  const voiced = Array.from(cleanMidi(track, { noiseRms: S.noiseRms })).filter(Number.isFinite).length / 100;
  const ok = snr > 12 && voiced > 0.4;
  send(S, "mic_check", { method: "single_take_p10", input_sr: S.mic.sampleRate, settings: S.mic.settings, noise_rms: +S.noiseRms.toFixed(6), snr_db: +snr.toFixed(1), voiced_sec: voiced, ok });
  const after = $("#after"); after.classList.remove("hidden");
  if (ok) {
    $("#msg").innerHTML = `<span class="good">Sounds great.</span>`;
    after.innerHTML = `<button class="btn" id="next">Continue</button>`;
  } else {
    $("#msg").innerHTML = `<span class="warn">We could barely hear you. Try a quieter spot or move closer to the mic.</span>`;
    after.innerHTML = `<button class="btn" id="again">Try again</button><button class="btn ghost" id="next">Continue anyway</button>`;
    $("#again").onclick = micTest;
  }
  $("#next").onclick = pickSongs;
}

// ---------------------------------------------------------------- 3 pick songs
function pickSongs() {
  progress(3);
  const order = shuffle(S.songs.filter((s) => s.role === "target" && scorable(s)), rand); // random order avoids position effects
  screen(`
    <h2>Which of these could you sing from memory?</h2>
    <p>Tap every song where you know <b>the original recording</b> really well, well enough to sing along in your head right now.</p>
    <div class="chips" id="chips">
      ${order.map((s) => `<button class="chip" data-id="${s.id}" aria-pressed="false"><b>${esc(s.title)}</b><span>${esc(s.artist)}</span></button>`).join("")}
    </div>
    <div class="actions sticky"><button class="btn" id="go">I don't know any of these</button></div>`);
  const chips = [...app.querySelectorAll(".chip")];
  const upd = () => {
    const n = chips.filter((c) => c.getAttribute("aria-pressed") === "true").length;
    $("#go").textContent = n ? `Continue with ${n} song${n > 1 ? "s" : ""}` : "I don't know any of these";
  };
  chips.forEach((c) => (c.onclick = () => { c.setAttribute("aria-pressed", c.getAttribute("aria-pressed") === "true" ? "false" : "true"); upd(); }));
  $("#go").onclick = () => {
    const picked = chips.filter((c) => c.getAttribute("aria-pressed") === "true").map((c) => c.dataset.id);
    const ratings = order.map((s) => ({ song_id: s.id, selected: picked.includes(s.id), familiarity: picked.includes(s.id) ? 5 : null }));
    const chosen = shuffle(shuffle(picked, rand).slice(0, MAX_SONGS), rand);
    S.plan = chosen.map((id) => ({ song_id: id, role: "target" }));
    S.plan.push({ song_id: "happy_birthday", role: "control" }); // after targets, so its comfortable key can't carry over
    send(S, "familiarity", { format: "tap_known", ratings, n_selected: picked.length, plan: S.plan, list_order: order.map((s) => s.id) });
    singIntro();
  };
}

// ---------------------------------------------------------------- 4 sing
function singIntro() {
  progress(4);
  const n = S.plan.filter((p) => p.role === "target").length;
  screen(`
    <h2>How to sing it back</h2>
    <p>${n ? `You'll sing ${n} of your songs, then “Happy Birthday.”` : `No problem. You'll just sing “Happy Birthday.”`}</p>
    <ol class="plan compact">
      <li><span class="num">1</span><div><b>Hear it in your head first</b><span>Imagine the actual recording playing.</span></div></li>
      <li><span class="num">2</span><div><b>Sing along with it</b><span>Words, humming or “la la” are all fine. An octave lower or higher is fine too.</span></div></li>
      <li><span class="num">3</span><div><b>About 15 seconds is plenty</b><span>Tap again to stop.</span></div></li>
    </ol>
    <div class="actions"><button class="btn" id="go">Got it</button></div>`);
  $("#go").onclick = () => singTrial(0, 1);
}

async function singTrial(i, attempt) {
  if (i >= S.plan.length) return namingIntro();
  const p = S.plan[i], song = S.songs.find((s) => s.id === p.song_id), isControl = p.role === "control";
  progress(4, `${i + 1} of ${S.plan.length}`);
  screen(`
    <div class="trial">
      <p class="eyebrow">Song ${i + 1} of ${S.plan.length}</p>
      <h2 class="songtitle">${esc(song.title)}</h2>
      ${song.artist ? `<p class="artist">${esc(song.artist)}</p>` : ""}
      <p class="prompt">${isControl ? "Sing it in whatever key feels natural." : song.cue ? `Start from <span class="cue">“${esc(song.cue)}”</span> and keep going.` : esc(song.prompt || "Sing the part you know best.")}</p>
      ${recorderHTML(isControl ? "Tap when you're ready" : "Hear it in your head, then tap")}
      <p id="msg" class="center muted"></p>
      <div class="actions center hidden" id="after"></div>
    </div>`);
  const startedAt = new Date().toISOString();
  const rec = await recordWithButton({ maxSec: isControl ? 30 : 25, minSec: 3, onStart: () => { $("#msg").textContent = "Listening…"; } });
  $("#msg").textContent = "One moment…";
  await sleep(30);
  const { x, track } = analyze(rec.raw, rec.sr);
  const scores = scoreTrial(track, song, { noiseRms: S.noiseRms }, S.songs);
  const after = $("#after"); after.classList.remove("hidden");
  const save = (flags) => {
    const trialId = `${i}_${attempt}`;
    const payload = {
      trial_id: trialId, trial_index: i, attempt, song_id: song.id, role: p.role,
      reference_verified: !!song.reference?.verified, started_at: startedAt,
      rec_sec: +rec.sec.toFixed(2), input_sr: rec.sr, noise_rms: +S.noiseRms.toFixed(6),
      confidence: null, flags, version_known: $("input[name=ver]:checked")?.value || null, scores, track: packTrack(track),
    };
    S.trials.push(payload);
    send(S, "trial", payload);
    if (S.collecting && S.consent?.audio) uploadAudio(S, trialId, encodeWav(x, SR));
  };
  if (scores.voiced_sec < 3 && attempt < 3) {
    $("#msg").innerHTML = `<span class="warn">We didn't catch much singing. Try again a little louder?</span>`;
    after.innerHTML = `<button class="btn" id="again">Try again</button><button class="btn ghost" id="skip">Skip this song</button>`;
    $("#again").onclick = () => singTrial(i, attempt + 1);
    $("#skip").onclick = () => { send(S, "trial_skipped", { trial_index: i, song_id: song.id, role: p.role, attempts: attempt }); singTrial(i + 1, 1); };
    return;
  }
  $("#msg").innerHTML = `<span class="good">Got it.</span>`;
  // Songs with a famous version in another key: ask which one this person knows (PROTOCOL §5.1)
  const alts = song.alt_versions || [];
  const verQ = alts.length ? `<div class="verq"><p class="ql">Which version do you mostly hear?</p>
    <div class="seg center">${[["original", "The original"], ...alts.map((v, k) => [`alt${k}`, v[0].toUpperCase() + v.slice(1)]), ["unsure", "Not sure"]]
      .map(([v, l]) => `<label><input type="radio" name="ver" value="${v === "original" || v === "unsure" ? v : alts[+v.slice(3)]}"><span>${esc(l)}</span></label>`).join("")}</div></div>` : "";
  after.insertAdjacentHTML("beforebegin", verQ);
  after.innerHTML = `<button class="btn" id="next">Next</button>${attempt < 3 ? `<button class="btn ghost" id="redo">Redo</button>` : ""}
    ${isControl ? "" : `<button class="linkbtn" id="unsure">I didn't really know this one</button>`}`;
  $("#next").onclick = () => { save([]); singTrial(i + 1, 1); };
  $("#redo")?.addEventListener("click", () => { save(["redo"]); singTrial(i, attempt + 1); });
  $("#unsure")?.addEventListener("click", () => { save(["unsure_part"]); singTrial(i + 1, 1); });
}

// ---------------------------------------------------------------- 5 note naming
function namingSequence() {
  // each pitch class once, octaves 3–5 (MIDI 48–83), successive notes ≥ 7 semitones apart
  for (let tries = 0; tries < 1000; tries++) {
    const seq = shuffle([...Array(12).keys()], rand).map((pc) => 12 * (4 + Math.floor(rand() * 3)) + pc);
    if (seq.every((m, k) => k === 0 || Math.abs(m - seq[k - 1]) >= 7)) return seq;
  }
  return shuffle([...Array(N_NAMING).keys()].map((k) => 48 + ((k * 7) % 36)), rand);
}

function namingIntro() {
  progress(5);
  screen(`
    <h2>Name that note</h2>
    <p>You'll hear ${N_NAMING} piano notes, each followed by a short burst of noise. Tap the key you think it was. The octave doesn't matter.</p>
    <p class="note">Most people can't do this, and that's expected. Your first instinct is the useful answer. Headphones help.</p>
    <div class="actions"><button class="btn" id="go">Start</button><button class="btn ghost" id="skip">I don't know note names</button></div>`);
  $("#go").onclick = () => namingRun(namingSequence());
  $("#skip").onclick = () => { send(S, "naming", { skipped: true, reason: "no_note_names" }); about(); };
}

function keyboardHTML() {
  const white = [0, 2, 4, 5, 7, 9, 11], black = [[1, 1], [3, 2], [6, 4], [8, 5], [10, 6]];
  const lab = (pc) => ({ 1: "C♯<br>D♭", 3: "D♯<br>E♭", 6: "F♯<br>G♭", 8: "G♯<br>A♭", 10: "A♯<br>B♭" })[pc] || NOTE_NAMES[pc];
  return `<div class="kbd" id="kbd">
    ${white.map((pc, k) => `<button class="w" data-pc="${pc}" style="left:${(k * 100) / 7}%" disabled>${lab(pc)}</button>`).join("")}
    ${black.map(([pc, pos]) => `<button class="b" data-pc="${pc}" style="left:calc(${(pos * 100) / 7}% - ${100 / 24}%)" disabled>${lab(pc)}</button>`).join("")}
  </div>`;
}

async function namingRun(seq) {
  screen(`
    <h2>Name that note</h2>
    <p id="status" class="muted">Get ready…</p>
    <div class="dots" id="dots">${seq.map(() => "<i></i>").join("")}</div>
    ${keyboardHTML()}`);
  const keys = [...app.querySelectorAll("#kbd button")], dots = [...app.querySelectorAll("#dots i")];
  const results = [];
  await sleep(1000);
  for (let k = 0; k < seq.length; k++) {
    progress(5, `${k + 1} of ${seq.length}`);
    $("#status").textContent = "Listen…";
    dots[k].className = "now";
    pianoTone(seq[k], 1.0);
    const t0 = performance.now();
    keys.forEach((b) => (b.disabled = false));
    $("#status").textContent = "Which note was that?";
    const pc = await new Promise((res) => keys.forEach((b) => (b.onclick = () => res(+b.dataset.pc))));
    const rt = performance.now() - t0;
    keys.forEach((b) => (b.disabled = true));
    dots[k].className = "done";
    const target = ((seq[k] % 12) + 12) % 12;
    const err = ((((pc - target) % 12) + 18) % 12) - 6;
    results.push({ k, midi: seq[k], target_pc: target, response_pc: pc, error: err, rt_ms: Math.round(rt) });
    if (k < seq.length - 1) { await sleep(250); maskBurst(0.9, rand); await sleep(1400); }
  }
  S.naming = results;
  send(S, "naming", { skipped: false, trials: results, timbre: "additive_piano_v1", n: seq.length });
  about();
}

// ---------------------------------------------------------------- 6 about you
const COMMON_LANGS = ["English", "Mandarin", "Cantonese", "Spanish", "Hindi", "Vietnamese", "Korean", "Japanese", "Tagalog", "Arabic", "French", "Punjabi", "Thai"];
const ALL_LANGS = [...COMMON_LANGS, "Taiwanese (Hokkien)", "Shanghainese (Wu)", "Lao", "Burmese", "Hmong", "Yoruba", "Igbo", "Akan (Twi)", "Zulu", "Xhosa", "German", "Urdu", "Bengali", "Tamil", "Telugu", "Russian", "Portuguese", "Swedish", "Norwegian", "Serbian / Croatian / Bosnian", "Italian", "Persian (Farsi)", "Turkish", "Hebrew", "Indonesian / Malay", "Swahili", "Amharic"];

const choice = (name, opts) => `<div class="seg" role="radiogroup">${opts.map(([v, l]) =>
  `<label><input type="radio" name="${name}" value="${v}"><span>${l}</span></label>`).join("")}</div>`;
const splitList = (s) => (s || "").split(/[,;\n]/).map((x) => x.trim().slice(0, 60)).filter(Boolean);

function about() {
  progress(6);
  screen(`
    <h2>Last bit: a little about you</h2>
    <p class="muted">Six quick questions. Skip any you'd rather not answer.</p>
    <datalist id="langs">${ALL_LANGS.map((l) => `<option value="${l}">`).join("")}</datalist>

    <div class="q">
      <p class="ql"><span>1</span>Which language(s) did you speak at home growing up, before about age 6?</p>
      <div class="chips small" id="native">${COMMON_LANGS.map((l) => `<button class="chip" data-lang="${l}" aria-pressed="false">${l}</button>`).join("")}</div>
      <input id="native_other" list="langs" placeholder="Others? Separate with commas" aria-label="Other languages spoken growing up">
    </div>
    <div class="q">
      <p class="ql"><span>2</span>Any other languages you speak fluently, learned later?</p>
      <input id="later" list="langs" placeholder="e.g. Spanish, Mandarin (optional)" aria-label="Other fluent languages">
    </div>
    <div class="q">
      <p class="ql"><span>3</span>How many years of music lessons (instrument or voice) have you had?</p>
      ${choice("lessons", [["0", "None"], ["lt2", "Less than 2"], ["2-5", "2–5"], ["6+", "6 or more"]])}
      <div id="lessons_more" class="hidden sub">
        <p class="ql">How old were you when you started?</p>
        ${choice("lesson_age", [["le6", "6 or younger"], ["7-9", "7–9"], ["10+", "10 or older"]])}
        <p class="ql">Did you learn “do re mi” with <b>do always = C</b>?</p>
        ${choice("solfege", [["fixed", "Yes, do = C"], ["movable", "No, do moved with the key"], ["none", "Never learned it"], ["unsure", "Not sure"]])}
      </div>
    </div>
    <div class="q">
      <p class="ql"><span>4</span>Do you have perfect pitch (can you name a note without hearing a reference)?</p>
      ${choice("ap_self", [["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]])}
    </div>
    <div class="q">
      <p class="ql"><span>5</span>How old are you?</p>
      <input id="age" type="number" min="18" max="110" inputmode="numeric" class="short" aria-label="Age">
    </div>
    <div class="q">
      <p class="ql"><span>6</span>Did either of these apply today?</p>
      <label class="check"><input type="checkbox" id="heard_music"><span>I heard music from somewhere during the study</span></label>
      <label class="check"><input type="checkbox" id="hearing"><span>I have a hearing difficulty</span></label>
    </div>
    <div class="actions"><button class="btn" id="go">See my results</button></div>`);
  app.querySelectorAll("#native .chip").forEach((c) => (c.onclick = () => c.setAttribute("aria-pressed", c.getAttribute("aria-pressed") === "true" ? "false" : "true")));
  app.querySelectorAll('input[name="lessons"]').forEach((r) => (r.onchange = () => $("#lessons_more").classList.toggle("hidden", r.value === "0" && r.checked)));
  $("#go").onclick = () => {
    const radio = (n) => $(`input[name="${n}"]:checked`)?.value || null;
    const native = [...app.querySelectorAll('#native .chip[aria-pressed="true"]')].map((c) => c.dataset.lang).concat(splitList($("#native_other").value));
    const later = splitList($("#later").value).filter((l) => !native.some((n) => n.toLowerCase() === l.toLowerCase()));
    // Same shape as v1 so analysis/analyze.py codes language groups unchanged:
    // grew-up languages = age_started 0, native-like; later fluent languages = fluency 4, age unknown.
    const languages = [
      ...native.map((name, k) => ({ order: k, name, age_started: 0, fluency: 5, use_now: null, source: "home_before_6" })),
      ...later.map((name, k) => ({ order: native.length + k, name, age_started: null, fluency: 4, use_now: null, source: "later_fluent" })),
    ];
    const band = radio("lessons");
    const years = { "0": 0, lt2: 1, "2-5": 3.5, "6+": 8 }[band] ?? null;
    const ageBand = radio("lesson_age");
    const ageN = $("#age").value === "" ? null : +$("#age").value;
    const q = {
      format: FLOW_VERSION, languages,
      lessons: band == null ? null : band === "0" ? "no" : "yes", lesson_years_band: band, lesson_years: years,
      lesson_age_band: band === "0" ? null : ageBand, lesson_age: band === "0" ? null : ({ le6: 5, "7-9": 8, "10+": 11 }[ageBand] ?? null),
      solfege: band === "0" ? "none" : radio("solfege"), ap_self: radio("ap_self"),
      age: ageN, heard_music: $("#heard_music").checked ? "yes" : "no", hearing: $("#hearing").checked ? "yes" : "no",
    };
    send(S, "questionnaire", q);
    results();
  };
}

// ---------------------------------------------------------------- 7 results
function describe(dev) {
  const a = Math.abs(dev);
  if (a < 0.5) return "right on the original key";
  return `${a.toFixed(1)} semitone${a >= 1.5 ? "s" : ""} ${dev > 0 ? "high" : "low"}`;
}

function results() {
  progress(7);
  $("#stepLabel").textContent = "";
  const sung = S.trials.filter((t) => t.role === "target" && !t.flags.includes("redo"));
  const targets = sung.filter((t) => reliable(t) && !t.flags.includes("unsure_part") && [null, "original", "unsure"].includes(t.version_known));
  const unscored = sung.filter((t) => !targets.includes(t));
  const hb = S.trials.find((t) => t.role === "control" && !t.flags.includes("redo") && reliable(t));
  const mean = targets.length ? targets.reduce((s, t) => s + Math.abs(t.scores.primary.deviation), 0) / targets.length : null;
  const anyUnverified = targets.some((t) => !t.reference_verified);
  const named = S.naming.length ? S.naming.filter((r) => r.error === 0).length : null;
  const near = S.naming.length ? S.naming.filter((r) => Math.abs(r.error) <= 1).length : null;
  send(S, "complete", { n_trials: S.trials.length, mean_abs_dev: mean });
  const songName = (id) => S.songs.find((s) => s.id === id)?.title || id;
  const verdict = mean == null ? "" : mean < 1 ? "That's remarkably close. Your memory seems to hold on to the actual pitch of songs."
    : mean < 2 ? "That's closer than chance. Your memory seems to keep some of the real pitch."
    : "That's in the range random keys would give. Totally normal: most people remember the tune, not the key.";
  screen(`
    <p class="eyebrow">Thank you!</p>
    <h1>Here's how you did</h1>
    ${targets.length ? `
      <div class="big"><b>${mean.toFixed(1)}</b><span>semitones away from the original keys, on average</span></div>
      <p>${verdict} Singing in random keys would land about <b>3 semitones</b> away.</p>
      <div class="bars">${targets.map((t) => {
        const d = t.scores.primary.deviation;
        return `<div class="bar"><span class="bl">${esc(songName(t.song_id))}</span>
          <span class="track"><span class="zero"></span><span class="pt" style="left:${Math.max(3, Math.min(97, 50 + (d / 6) * 50))}%"></span></span>
          <span class="bd">${describe(d)}</span></div>`;
      }).join("")}
        <div class="axis"><span>6 low</span><span>original key</span><span>6 high</span></div>
      </div>` : `<p>We couldn't measure your songs precisely this time, but your other answers still help.</p>`}
    ${unscored.length && targets.length ? `<p class="muted small">We couldn't measure ${unscored.map((t) => `<em>${esc(songName(t.song_id))}</em>`).join(" or ")} precisely enough to score it, so it's left out.</p>` : ""}
    ${hb?.scores?.template ? `<p>You sang “Happy Birthday” in about <b>${NOTE_NAMES[((Math.round(hb.scores.template.deviation) % 12) + 12) % 12]} major</b>. It has no “right” key, so this shows where your voice is comfortable.</p>` : ""}
    ${named != null ? `<div class="big small"><b>${named} / ${S.naming.length}</b><span>notes named exactly (${near} within one key). Guessing gets about 1.</span></div>` : ""}
    ${anyUnverified ? `<p class="muted small">The reference keys in this version are still being checked against the recordings, so treat these numbers as rough.</p>` : ""}

    <hr>
    <h2>What this study is about</h2>
    <p>Very few people have <b>perfect pitch</b>, the ability to name a note out of the blue. But many ordinary people sing pop songs within a semitone or two of the recorded key (Levitin, 1994). Almost everyone seems to <em>remember</em> pitch, even if they can't <em>name</em> it.</p>
    <p>Speakers of tone languages like Mandarin have perfect pitch far more often. We're testing whether language helps people <b>name</b> pitches, <b>remember</b> them, or both.</p>
    <p class="muted">Please don't tell friends the details before they try it. It works best when people come in fresh.</p>
    <div class="actions"><button class="btn ghost" id="dl">Download my data</button></div>
    <p class="muted small">Session ID <code>${S.id}</code>. Keep this if you'd ever like your data withdrawn.</p>`);
  $("#dl").onclick = () => {
    const blob = new Blob([JSON.stringify({ session_id: S.id, events: log }, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `sing-it-back_${S.id.slice(0, 8)}.json`; a.click();
  };
  S.mic?.close();
  window.onbeforeunload = null;
}

window.onbeforeunload = (e) => { if (S.step > 1 && S.step < 7) { e.preventDefault(); return ""; } };
window.addEventListener("error", (e) => { try { send(S, "client_error", { msg: String(e.message).slice(0, 300), step: S.step }); } catch {} });
welcome();
