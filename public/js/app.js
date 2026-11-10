// =====================================================================
//  Sing It Back — participant flow
//  welcome → consent → mic check → song familiarity → sing (targets,
//  Happy Birthday control, retest) → speech → vocal range → note naming
//  → questionnaire → results & debrief
//  Order matters: no external tones are played until all singing is done,
//  so nothing in the study can give people a reference pitch.
// =====================================================================
import { resample, trackPitch, scoreTrial, packTrack, cleanMidi, median, quantile, mulberry32, shuffle, midiToName, NOTE_NAMES, SR, ANALYSIS_VERSION } from "./pitch.js";
import { openMic, meter, pianoTone, maskBurst, encodeWav } from "./audio.js";
import { getConfig, send, uploadAudio, log } from "./api.js";

const APP_VERSION = "0.1.0";
const MAX_SONGS = 5;
const N_NAMING = 24;
const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15); return (c === "x" ? r : (r & 3) | 8).toString(16);
}));

const S = {
  id: uuid(), app_version: APP_VERSION, analysis_version: ANALYSIS_VERSION,
  seed: crypto.getRandomValues(new Uint32Array(1))[0],
  collecting: false, mode: "offline", consent: null, songs: null, songsVersion: null,
  mic: null, noiseRms: 0, plan: [], trials: [], naming: [], step: 0,
};
const rand = mulberry32(S.seed);
let STEPS_TOTAL = 9;

function progress(step, label) {
  S.step = step;
  $("#progress").style.width = Math.round((100 * step) / STEPS_TOTAL) + "%";
  $("#stepLabel").textContent = label || "";
}
function screen(html) { app.innerHTML = html; window.scrollTo(0, 0); app.focus?.(); }

// ---------------------------------------------------------------------
async function welcome() {
  progress(0, "");
  const cfg = await getConfig();
  S.collecting = !!cfg.collecting; S.mode = cfg.mode; S.irb = cfg.irb_protocol; S.audioEnabled = !!cfg.audio;
  const r = await fetch("songs.json", { cache: "no-store" });
  const sj = await r.json();
  S.songs = sj.songs; S.songsVersion = sj.version;
  const supported = !!(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
  if (!S.collecting) $("#banner").innerHTML = `<div class="banner">Demo mode: nothing you do here is saved or sent anywhere. You can download your own results at the end.</div>`;
  screen(`
    <section class="card hero">
      <p class="eyebrow">A Stanford music study · about 12 minutes</p>
      <h1>How well do you remember the sound of a song?</h1>
      <p class="lede">You'll sing (or hum) a few songs you know really well, straight from memory. We measure how close you get to the <em>key</em> of the original recording. You don't need to be a good singer. Off-key and hummed are completely fine.</p>
      <ul class="checks">
        <li>A laptop or phone with a microphone</li>
        <li>A quiet room where you're comfortable singing out loud</li>
        <li>Please <strong>don't listen to any music</strong> until you're done</li>
      </ul>
      ${supported ? `<button class="btn" id="go">Start</button>` : `<p class="warn">This browser can't record audio. Please open the page in a recent version of Chrome, Edge, Firefox or Safari.</p>`}
    </section>`);
  $("#go")?.addEventListener("click", consent);
}

// ---------------------------------------------------------------------
async function consent() {
  progress(1, "Consent");
  let text = "";
  try { text = await (await fetch("consent.html", { cache: "no-store" })).text(); } catch { text = "<p>Consent text could not be loaded.</p>"; }
  screen(`
    <section class="card">
      <h2>Before you begin</h2>
      <div class="consent">${text}</div>
      <label class="check"><input type="checkbox" id="c_age"> I am 18 or older.</label>
      <label class="check"><input type="checkbox" id="c_ok"> I have read the information above and agree to take part.</label>
      ${S.audioEnabled ? `<label class="check optional"><input type="checkbox" id="c_audio"> <span><strong>Optional:</strong> you may also keep the audio recordings of my singing for research. (If you leave this unchecked, only pitch measurements are saved — never the sound itself.)</span></label>` : ""}
      <div class="row"><button class="btn" id="go" disabled>I agree, continue</button></div>
    </section>`);
  const upd = () => { $("#go").disabled = !($("#c_age").checked && $("#c_ok").checked); };
  $("#c_age").onchange = upd; $("#c_ok").onchange = upd;
  $("#go").onclick = () => {
    S.consent = { adult: true, agree: true, audio: !!$("#c_audio")?.checked, time: new Date().toISOString() };
    send(S, "session_start", {
      seed: S.seed, analysis_version: ANALYSIS_VERSION, songs_version: S.songsVersion, mode: S.mode, irb_protocol: S.irb ?? null,
      consent: S.consent, referrer: document.referrer || null, url_params: Object.fromEntries(new URLSearchParams(location.search)),
      device: { ua: navigator.userAgent, lang: navigator.language, langs: navigator.languages, screen: [window.screen.width, window.screen.height], tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
    });
    micCheck();
  };
}

// ---------------------------------------------------------------------
async function record(maxSec, { onTick, minSec = 0 } = {}) {
  // returns { raw, sr, sec } after Stop or timeout
  const mic = S.mic;
  mic.start();
  const t0 = performance.now();
  let stopFn;
  const done = new Promise((res) => { stopFn = res; });
  const iv = setInterval(() => {
    const sec = (performance.now() - t0) / 1000;
    onTick?.(sec);
    if (sec >= maxSec) stopFn();
  }, 100);
  const stopBtn = $("#stop");
  if (stopBtn) {
    stopBtn.disabled = true;
    setTimeout(() => { stopBtn.disabled = false; }, minSec * 1000);
    stopBtn.onclick = () => stopFn();
  }
  await done;
  clearInterval(iv);
  const raw = mic.stop();
  return { raw, sr: mic.sampleRate, sec: raw.length / mic.sampleRate };
}
function analyze(raw, sr) {
  const x = resample(raw, sr, SR);
  return { x, track: trackPitch(x, SR) };
}
const rmsOf = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); };

async function micCheck() {
  progress(2, "Microphone check");
  screen(`
    <section class="card">
      <h2>Microphone check</h2>
      <p>Your browser will ask to use the microphone. Nothing is recorded until you press a button.</p>
      <div class="meter"><div id="lvl"></div></div>
      <p id="msg" class="muted"></p>
      <div class="row"><button class="btn" id="go">Allow microphone</button></div>
    </section>`);
  $("#go").onclick = async () => {
    try {
      S.mic = S.mic || (await openMic());
    } catch (e) {
      $("#msg").innerHTML = `<span class="warn">We couldn't open the microphone (${esc(e.name || e.message)}). Check your browser's site permissions and try again.</span>`;
      return;
    }
    const stopMeter = meter(S.mic, $("#lvl"));
    const go = $("#go");
    go.textContent = "Measure room noise";
    $("#msg").textContent = "Great, the bar should move when you talk. Next, we measure how noisy your room is. Press the button and stay quiet for 3 seconds.";
    go.onclick = async () => {
      go.disabled = true; $("#msg").textContent = "Shh… measuring (3 s)";
      const quiet = await record(3);
      const qx = resample(quiet.raw, quiet.sr, SR);
      S.noiseRms = rmsOf(qx.subarray(Math.floor(0.3 * SR)));
      go.disabled = false; go.textContent = "Test my voice";
      $("#msg").textContent = "Now press the button and say “testing, one, two, three” in a normal voice.";
      go.onclick = async () => {
        go.disabled = true; $("#msg").textContent = "Listening… (3 s)";
        const talk = await record(3);
        const { x, track } = analyze(talk.raw, talk.sr);
        const snr = 20 * Math.log10(Math.max(rmsOf(x), 1e-6) / Math.max(S.noiseRms, 1e-6));
        const voiced = Array.from(cleanMidi(track, { noiseRms: S.noiseRms })).filter(Number.isFinite).length / 100;
        const ok = snr > 12 && voiced > 0.4;
        send(S, "mic_check", { input_sr: S.mic.sampleRate, settings: S.mic.settings, noise_rms: +S.noiseRms.toFixed(6), snr_db: +snr.toFixed(1), voiced_sec: voiced, ok });
        stopMeter();
        if (ok) {
          $("#msg").innerHTML = `<span class="good">Sounds good.</span>`;
          go.disabled = false; go.textContent = "Continue"; go.onclick = familiarity;
        } else {
          $("#msg").innerHTML = `<span class="warn">We could barely hear you over the background (${snr.toFixed(0)} dB). Try moving somewhere quieter or closer to the mic.</span>`;
          go.disabled = false; go.textContent = "Try again"; go.onclick = () => micCheck();
          const skip = document.createElement("button"); skip.className = "btn ghost"; skip.textContent = "Continue anyway";
          skip.onclick = familiarity; go.after(skip);
        }
      };
    };
  };
}

// ---------------------------------------------------------------------
function familiarity() {
  progress(3, "Pick your songs");
  const targets = S.songs.filter((s) => s.role === "target");
  const order = shuffle(targets, rand); // random list order to avoid position effects
  screen(`
    <section class="card">
      <h2>Which of these songs do you know really well?</h2>
      <p>For each song, choose how well you know <strong>the original recording</strong>. We'll pick up to ${MAX_SONGS} of the ones you know best.</p>
      <div class="songs">
        ${order.map((s) => `
          <div class="song" data-id="${s.id}">
            <div class="songname"><strong>${esc(s.title)}</strong><span>${esc(s.artist)}${s.year ? " · " + s.year : ""}</span></div>
            <div class="seg" role="radiogroup" aria-label="How well do you know ${esc(s.title)}">
              ${["Never heard it", "Heard it", "Know it", "Know it well", "Could sing it in my sleep"].map((l, i) => `
                <label><input type="radio" name="f_${s.id}" value="${i + 1}"><span>${l}</span></label>`).join("")}
            </div>
            <div class="src hidden">
              <span class="muted">Mostly heard as:</span>
              <select data-src="${s.id}">
                <option value="">choose…</option><option value="original">the original recording</option>
                <option value="other">covers, remixes, sped-up / slowed versions</option><option value="both">both about equally</option>
              </select>
              <label class="mini"><input type="checkbox" data-played="${s.id}"> I've played or sung it myself (e.g. lessons, karaoke, choir)</label>
            </div>
          </div>`).join("")}
      </div>
      <p id="msg" class="muted"></p>
      <div class="row"><button class="btn" id="go" disabled>Continue</button></div>
    </section>`);
  const rows = [...app.querySelectorAll(".song")];
  const upd = () => {
    let rated = 0;
    for (const row of rows) {
      const v = +($(`input[name="f_${row.dataset.id}"]:checked`, row)?.value || 0);
      if (v) rated++;
      $(".src", row).classList.toggle("hidden", v < 4);
    }
    $("#go").disabled = rated < rows.length;
    $("#msg").textContent = rated < rows.length ? `${rows.length - rated} left to rate` : "";
  };
  $(".songs").addEventListener("change", upd);
  $("#go").onclick = () => {
    const fam = rows.map((row) => ({
      song_id: row.dataset.id,
      familiarity: +$(`input[name="f_${row.dataset.id}"]:checked`, row).value,
      heard_as: $(`[data-src="${row.dataset.id}"]`, row).value || null,
      performed: $(`[data-played="${row.dataset.id}"]`, row).checked,
    }));
    // eligible: rated 4–5; prefer 5s, then 4s; random within each level
    const fives = shuffle(fam.filter((f) => f.familiarity === 5), rand);
    const fours = shuffle(fam.filter((f) => f.familiarity === 4), rand);
    const chosen = [...fives, ...fours].slice(0, MAX_SONGS).map((f) => f.song_id);
    const ordered = shuffle(chosen, rand);
    S.plan = ordered.map((id) => ({ song_id: id, role: "target" }));
    S.plan.push({ song_id: "happy_birthday", role: "control" });
    if (ordered.length) S.plan.push({ song_id: ordered[0], role: "retest" });
    send(S, "familiarity", { ratings: fam, plan: S.plan, list_order: order.map((s) => s.id) });
    singIntro();
  };
}

// ---------------------------------------------------------------------
function singIntro() {
  progress(4, "Singing");
  const n = S.plan.filter((p) => p.role === "target").length;
  screen(`
    <section class="card">
      <h2>Singing from memory</h2>
      ${n ? `<p>You'll sing <strong>${n} song${n > 1 ? "s" : ""}</strong> you know well, then “Happy Birthday,” then one song again.</p>`
          : `<p>It looks like none of the songs is one you know really well, which is completely fine. You'll sing “Happy Birthday” and then do a few short tasks.</p>`}
      <ol class="howto">
        <li><strong>First, play the original recording in your head.</strong> Imagine it coming out of your speakers.</li>
        <li>Press <em>Record</em> and sing or hum along with that imagined recording. Aim for the same notes as the singer, even if they're too high or low for you. Then you can sing an octave lower or higher.</li>
        <li>Sing for about 10–20 seconds, then press <em>Done</em>.</li>
      </ol>
      <p class="muted">There's no feedback until the very end, so you won't know how you did yet. Please don't look up or play the songs.</p>
      <div class="row"><button class="btn" id="go">I'm ready</button></div>
    </section>`);
  $("#go").onclick = () => singTrial(0, 1);
}

async function singTrial(i, attempt) {
  if (i >= S.plan.length) return speech();
  const p = S.plan[i];
  const song = S.songs.find((s) => s.id === p.song_id);
  const isControl = p.role === "control";
  progress(4, `Singing · ${i + 1} of ${S.plan.length}`);
  screen(`
    <section class="card trial">
      <p class="eyebrow">${p.role === "retest" ? "One more time" : `Song ${i + 1} of ${S.plan.length}`}</p>
      <h2 class="songtitle">${esc(song.title)}</h2>
      ${song.artist ? `<p class="artist">${esc(song.artist)}</p>` : ""}
      <p>${isControl ? esc(song.prompt) : `${esc(song.prompt)} <strong>Hear the original recording in your head first</strong>, then sing along with it.`}</p>
      <div class="recbox">
        <div class="meter big"><div id="lvl"></div></div>
        <div class="timer" id="timer">0:00</div>
      </div>
      <div class="row">
        <button class="btn rec" id="rec">● Record</button>
        <button class="btn ghost hidden" id="stop">Done</button>
      </div>
      <p id="msg" class="muted"></p>
    </section>`);
  const stopMeter = meter(S.mic, $("#lvl"));
  const startedAt = new Date().toISOString();
  $("#rec").onclick = async () => {
    $("#rec").classList.add("hidden"); $("#stop").classList.remove("hidden");
    $("#msg").textContent = "Recording… sing now.";
    const rec = await record(isControl ? 35 : 25, {
      minSec: 3,
      onTick: (s) => { $("#timer").textContent = `0:${String(Math.floor(s)).padStart(2, "0")}`; },
    });
    stopMeter();
    $("#stop").classList.add("hidden"); $("#msg").textContent = "Analyzing…";
    await sleep(30);
    const { x, track } = analyze(rec.raw, rec.sr);
    const scores = scoreTrial(track, song, { noiseRms: S.noiseRms });
    if (scores.voiced_sec < 3 && attempt < 3) {
      screenRetry(i, attempt, scores);
      return;
    }
    afterTrial(i, attempt, { song, p, rec, x, track, scores, startedAt });
  };
}

function screenRetry(i, attempt, scores) {
  $("#msg").innerHTML = `<span class="warn">We only heard about ${scores.voiced_sec.toFixed(1)} seconds of singing. Try again a little louder or closer to the mic?</span>`;
  const r = $(".row");
  r.innerHTML = `<button class="btn" id="again">Try again</button><button class="btn ghost" id="skip">Skip this song</button>`;
  $("#again").onclick = () => singTrial(i, attempt + 1);
  $("#skip").onclick = () => {
    send(S, "trial_skipped", { trial_index: i, song_id: S.plan[i].song_id, role: S.plan[i].role, attempts: attempt });
    singTrial(i + 1, 1);
  };
}

function afterTrial(i, attempt, t) {
  const isTarget = t.p.role !== "control";
  const r = $(".row");
  $("#msg").textContent = "";
  r.outerHTML = `
    <div class="followup">
      ${isTarget ? `
      <p><strong>How sure are you that you sang it in the same key as the recording?</strong></p>
      <div class="seg" id="conf">${["Just guessing", "Not very", "Somewhat", "Fairly", "Very sure"].map((l, k) => `<label><input type="radio" name="conf" value="${k + 1}"><span>${l}</span></label>`).join("")}</div>` : ""}
      <details><summary>Something went wrong?</summary>
        <label class="check"><input type="checkbox" value="unsure_part"> I didn't really know this part of the song</label>
        <label class="check"><input type="checkbox" value="heard_music"> I could hear music or other singing around me</label>
        <label class="check"><input type="checkbox" value="interrupted"> I was interrupted or the recording cut off</label>
        <label class="check"><input type="checkbox" value="redo"> I'd like to record it again</label>
      </details>
      <div class="row"><button class="btn" id="next" ${isTarget ? "disabled" : ""}>Next</button></div>
    </div>`;
  if (isTarget) $("#conf").onchange = () => { $("#next").disabled = false; };
  $("#next").onclick = () => {
    const flags = [...app.querySelectorAll("details input:checked")].map((c) => c.value);
    const conf = +($("input[name=conf]:checked")?.value || 0) || null;
    const trialId = `${i}_${attempt}`;
    const payload = {
      trial_id: trialId, trial_index: i, attempt, song_id: t.song.id, role: t.p.role,
      reference_verified: !!t.song.reference?.verified, started_at: t.startedAt,
      rec_sec: +t.rec.sec.toFixed(2), input_sr: t.rec.sr, noise_rms: +S.noiseRms.toFixed(6),
      confidence: conf, flags, scores: t.scores, track: packTrack(t.track),
    };
    S.trials.push(payload);
    send(S, "trial", payload);
    if (S.collecting && S.consent?.audio) uploadAudio(S, trialId, encodeWav(t.x, SR));
    if (flags.includes("redo") && attempt < 3) return singTrial(i, attempt + 1);
    singTrial(i + 1, 1);
  };
}

// ---------------------------------------------------------------------
function speech() {
  progress(5, "Speaking voice");
  screen(`
    <section class="card">
      <h2>Your speaking voice</h2>
      <p>Press <em>Record</em> and read this aloud in your normal speaking voice:</p>
      <blockquote>“The music played softly while we walked home. Nobody remembered the name of the song, but everyone could hum it.”</blockquote>
      <div class="meter"><div id="lvl"></div></div>
      <div class="row"><button class="btn rec" id="rec">● Record</button><button class="btn ghost hidden" id="stop">Done</button></div>
      <p id="msg" class="muted"></p>
    </section>`);
  const stopMeter = meter(S.mic, $("#lvl"));
  $("#rec").onclick = async () => {
    $("#rec").classList.add("hidden"); $("#stop").classList.remove("hidden"); $("#msg").textContent = "Recording…";
    const rec = await record(15, { minSec: 2 });
    stopMeter();
    const { track } = analyze(rec.raw, rec.sr);
    const m = cleanMidi(track, { noiseRms: S.noiseRms });
    send(S, "speech", { task: "english_sentence", rec_sec: +rec.sec.toFixed(2), median_midi: +median(m).toFixed(2) || null, track: packTrack(track) });
    speechOther();
  };
}
function speechOther() {
  screen(`
    <section class="card">
      <h2>Another language? (optional)</h2>
      <p>If you grew up speaking a language other than English, please count from one to ten in that language. If not, just skip this.</p>
      <label>Which language? <input id="lang" placeholder="e.g. Mandarin, Spanish, Hindi"></label>
      <div class="meter"><div id="lvl"></div></div>
      <div class="row"><button class="btn rec" id="rec">● Record</button><button class="btn ghost hidden" id="stop">Done</button><button class="btn ghost" id="skip">Skip</button></div>
    </section>`);
  const stopMeter = meter(S.mic, $("#lvl"));
  $("#skip").onclick = () => { stopMeter(); range(); };
  $("#rec").onclick = async () => {
    $("#rec").classList.add("hidden"); $("#skip").classList.add("hidden"); $("#stop").classList.remove("hidden");
    const rec = await record(15, { minSec: 2 });
    stopMeter();
    const { track } = analyze(rec.raw, rec.sr);
    const m = cleanMidi(track, { noiseRms: S.noiseRms });
    send(S, "speech", { task: "count_other_language", language: $("#lang").value.trim().slice(0, 60), rec_sec: +rec.sec.toFixed(2), median_midi: +median(m).toFixed(2) || null, track: packTrack(track) });
    range();
  };
}

function range() {
  progress(6, "Vocal range");
  screen(`
    <section class="card">
      <h2>Your vocal range</h2>
      <p>On an “ahh,” slide slowly from your <strong>lowest</strong> comfortable note up to your <strong>highest</strong>, like a siren, then back down. It's fine if your voice cracks.</p>
      <div class="meter"><div id="lvl"></div></div>
      <div class="row"><button class="btn rec" id="rec">● Record</button><button class="btn ghost hidden" id="stop">Done</button></div>
    </section>`);
  const stopMeter = meter(S.mic, $("#lvl"));
  $("#rec").onclick = async () => {
    $("#rec").classList.add("hidden"); $("#stop").classList.remove("hidden");
    const rec = await record(12, { minSec: 2 });
    stopMeter();
    const { track } = analyze(rec.raw, rec.sr);
    const m = cleanMidi(track, { noiseRms: S.noiseRms });
    send(S, "range", { rec_sec: +rec.sec.toFixed(2), p05_midi: +quantile(m, 0.05).toFixed(2) || null, p95_midi: +quantile(m, 0.95).toFixed(2) || null, track: packTrack(track) });
    namingIntro();
  };
}

// ---------------------------------------------------------------------
function namingSequence() {
  for (let tries = 0; tries < 500; tries++) {
    const pcs = shuffle([...Array(12).keys(), ...Array(12).keys()], rand);
    const seq = pcs.map((pc) => 12 * (4 + Math.floor(rand() * 3)) + pc); // octaves 3–5 (MIDI 48–83)
    if (seq.every((m, k) => k === 0 || Math.abs(m - seq[k - 1]) >= 7)) return seq;
  }
  return shuffle([...Array(N_NAMING).keys()].map((k) => 48 + (k * 7) % 36), rand);
}

function namingIntro() {
  progress(7, "Name the note");
  screen(`
    <section class="card">
      <h2>Name the note</h2>
      <p>Now you'll hear ${N_NAMING} single piano notes, each followed by a burst of noise. After each one, click the note's name. The octave doesn't matter.</p>
      <p><strong>Most people can't do this, and that's expected.</strong> Just go with your first instinct. Your guesses are useful data too. Headphones help but aren't required.</p>
      <div class="row"><button class="btn" id="go">Start</button><button class="btn ghost" id="skip">I don't know note names — skip</button></div>
    </section>`);
  $("#go").onclick = () => namingRun(namingSequence());
  $("#skip").onclick = () => { send(S, "naming", { skipped: true, reason: "no_note_names" }); questionnaire(); };
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
    <section class="card">
      <h2>Name the note</h2>
      <p id="status" class="muted">Get ready…</p>
      <div class="progress small"><div id="np"></div></div>
      ${keyboardHTML()}
    </section>`);
  const keys = [...app.querySelectorAll("#kbd button")];
  const results = [];
  await sleep(1200);
  for (let k = 0; k < seq.length; k++) {
    $("#status").textContent = `Note ${k + 1} of ${seq.length}`;
    $("#np").style.width = (100 * k) / seq.length + "%";
    pianoTone(seq[k], 1.0);
    const t0 = performance.now();
    keys.forEach((b) => (b.disabled = false));
    const pc = await new Promise((res) => keys.forEach((b) => (b.onclick = () => res(+b.dataset.pc))));
    const rt = performance.now() - t0;
    keys.forEach((b) => (b.disabled = true));
    const target = ((seq[k] % 12) + 12) % 12;
    const err = ((((pc - target) % 12) + 18) % 12) - 6;
    results.push({ k, midi: seq[k], target_pc: target, response_pc: pc, error: err, rt_ms: Math.round(rt) });
    await sleep(250); maskBurst(0.9, rand); await sleep(1500);
  }
  S.naming = results;
  send(S, "naming", { skipped: false, trials: results, timbre: "additive_piano_v1" });
  questionnaire();
}

// ---------------------------------------------------------------------
const LANGS = ["English", "Mandarin", "Cantonese", "Taiwanese (Hokkien)", "Shanghainese (Wu)", "Vietnamese", "Thai", "Lao", "Burmese", "Hmong", "Punjabi", "Yoruba", "Igbo", "Akan (Twi)", "Zulu", "Xhosa", "Japanese", "Korean", "Spanish", "French", "German", "Hindi", "Urdu", "Bengali", "Tamil", "Telugu", "Tagalog", "Arabic", "Russian", "Portuguese", "Swedish", "Norwegian", "Serbian / Croatian / Bosnian", "Italian", "Persian (Farsi)", "Turkish", "Hebrew", "Indonesian / Malay", "Swahili", "Amharic"];

function langRow(n) {
  return `<div class="langrow" data-n="${n}">
    <input class="lname" list="langs" placeholder="Language" aria-label="Language ${n + 1}">
    <label class="inl">Age started <input class="lage" type="number" min="0" max="99" inputmode="numeric"></label>
    <select class="lflu" aria-label="How well you speak it"><option value="">How well you speak it…</option><option value="5">Native-like</option><option value="4">Fluently</option><option value="3">Conversationally</option><option value="2">A little</option><option value="1">Understand only</option></select>
    <select class="luse" aria-label="How often you use it now"><option value="">Use it now…</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="rarely">Rarely</option><option value="never">Not anymore</option></select>
  </div>`;
}

function questionnaire() {
  progress(8, "About you");
  const sel = (id, opts) => `<select id="${id}"><option value="">choose…</option>${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`;
  const yn = [["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]];
  screen(`
    <section class="card form">
      <h2>A little about you</h2>
      <p class="muted">Almost done. These questions help us understand what shapes pitch memory. Skip any you prefer not to answer.</p>
      <datalist id="langs">${LANGS.map((l) => `<option value="${l}">`).join("")}</datalist>

      <h3>Languages</h3>
      <p class="muted">List every language you speak or understand, starting with the one(s) you grew up with.</p>
      <div id="langs_box">${langRow(0)}${langRow(1)}</div>
      <button class="btn ghost small" id="addlang">+ Add a language</button>
      <label>Where did you mostly grow up (country or region)? <input id="grew_up" maxlength="80"></label>

      <h3>Music</h3>
      <label>Have you ever had music lessons (instrument or voice)? ${sel("lessons", [["yes", "Yes"], ["no", "No"]])}</label>
      <div id="lessons_more" class="hidden">
        <label>Age at your first lessons <input id="lesson_age" type="number" min="0" max="99"></label>
        <label>Total years of lessons or regular practice <input id="lesson_years" type="number" min="0" max="90" step="0.5"></label>
        <label>Main instrument(s) <input id="instruments" maxlength="120" placeholder="e.g. piano, violin, voice"></label>
        <label>When you learned “do re mi,” was “do” always C (<em>fixed do</em>), or the first note of whatever key you were in (<em>movable do</em>)?
          ${sel("solfege", [["fixed", "Fixed do (do = C)"], ["movable", "Movable do"], ["both", "Both"], ["none", "I never learned do-re-mi"], ["unsure", "Not sure"]])}</label>
      </div>
      <label>Do you sing regularly (choir, a cappella, karaoke, in the shower)? ${sel("sing_freq", [["daily", "Most days"], ["weekly", "Weekly"], ["monthly", "Sometimes"], ["rarely", "Rarely or never"]])}</label>
      <label>Do you have perfect (absolute) pitch? That is, can you name a note you hear without any reference note? ${sel("ap_self", yn)}</label>
      <label>Does anyone in your family have perfect pitch? ${sel("ap_family", yn)}</label>
      <label>About how many hours a week do you listen to music? ${sel("listen_hours", [["0-2", "0–2"], ["3-7", "3–7"], ["8-14", "8–14"], ["15-30", "15–30"], ["30+", "More than 30"]])}</label>

      <h3>You and your setup</h3>
      <label>Age <input id="age" type="number" min="18" max="110"></label>
      <label>Gender ${sel("gender", [["woman", "Woman"], ["man", "Man"], ["nonbinary", "Non-binary"], ["self", "Prefer to self-describe"], ["na", "Prefer not to say"]])}</label>
      <label>Do you have any hearing difficulties? ${sel("hearing", [["no", "No"], ["yes", "Yes"], ["na", "Prefer not to say"]])}</label>
      <label>What microphone did you use? ${sel("mic_type", [["builtin_laptop", "Built-in laptop mic"], ["phone", "Phone"], ["earbuds", "Earbuds / AirPods"], ["headset", "Headset"], ["external", "External / USB mic"], ["unsure", "Not sure"]])}</label>
      <label>How quiet was your room? ${sel("room", [["quiet", "Quiet"], ["some", "Some background noise"], ["noisy", "Noisy"]])}</label>
      <label>Did you hear any music (from anywhere) during the study? ${sel("heard_music", [["no", "No"], ["yes", "Yes"]])}</label>
      <label>How did you hear about this study? <input id="source" maxlength="80"></label>
      <label>Anything else we should know? <textarea id="comments" maxlength="1000" rows="3"></textarea></label>
      <div class="row"><button class="btn" id="go">Submit and see my results</button></div>
    </section>`);
  let nLang = 2;
  $("#addlang").onclick = () => { if (nLang < 6) $("#langs_box").insertAdjacentHTML("beforeend", langRow(nLang++)); };
  $("#lessons").onchange = () => $("#lessons_more").classList.toggle("hidden", $("#lessons").value !== "yes");
  $("#go").onclick = () => {
    const v = (id) => $("#" + id)?.value?.trim() || null;
    const num = (id) => (v(id) == null ? null : +v(id));
    const languages = [...app.querySelectorAll(".langrow")].map((r, k) => ({
      order: k, name: $(".lname", r).value.trim().slice(0, 60), age_started: $(".lage", r).value === "" ? null : +$(".lage", r).value,
      fluency: +$(".lflu", r).value || null, use_now: $(".luse", r).value || null,
    })).filter((l) => l.name);
    const q = {
      languages, grew_up: v("grew_up"),
      lessons: v("lessons"), lesson_age: num("lesson_age"), lesson_years: num("lesson_years"), instruments: v("instruments"), solfege: v("solfege"),
      sing_freq: v("sing_freq"), ap_self: v("ap_self"), ap_family: v("ap_family"), listen_hours: v("listen_hours"),
      age: num("age"), gender: v("gender"), hearing: v("hearing"), mic_type: v("mic_type"), room: v("room"), heard_music: v("heard_music"),
      source: v("source"), comments: v("comments"),
    };
    send(S, "questionnaire", q);
    results();
  };
}

// ---------------------------------------------------------------------
function describe(dev) {
  const a = Math.abs(dev);
  if (a < 0.5) return "right on the original key";
  return `${a.toFixed(1)} semitone${a >= 1.5 ? "s" : ""} ${dev > 0 ? "higher" : "lower"} than the original`;
}

function results() {
  progress(9, "Your results");
  const targets = S.trials.filter((t) => t.role === "target" && t.scores.primary);
  const hb = S.trials.find((t) => t.role === "control");
  const retest = S.trials.find((t) => t.role === "retest" && t.scores.primary);
  const mean = targets.length ? targets.reduce((s, t) => s + Math.abs(t.scores.primary.deviation), 0) / targets.length : null;
  const anyUnverified = S.trials.some((t) => t.role !== "control" && !t.reference_verified);
  const named = S.naming.length ? S.naming.filter((r) => r.error === 0).length : null;
  const near = S.naming.length ? S.naming.filter((r) => Math.abs(r.error) <= 1).length : null;
  send(S, "complete", { n_trials: S.trials.length, mean_abs_dev: mean });
  const songName = (id) => S.songs.find((s) => s.id === id)?.title || id;
  screen(`
    <section class="card">
      <p class="eyebrow">Thank you!</p>
      <h2>Your results</h2>
      ${targets.length ? `
        <div class="stat"><b>${mean.toFixed(1)}</b><span>semitones: your average distance from the original keys</span></div>
        <p>If people sang in random keys, the average distance would be <strong>3 semitones</strong>. Anything well under that suggests your memory holds onto the actual pitch of songs, not just the tune.</p>
        <div class="bars">${targets.map((t) => {
          const d = t.scores.primary.deviation;
          return `<div class="bar"><span class="bl">${esc(songName(t.song_id))}</span>
            <span class="track"><span class="zero"></span><span class="dot" style="left:${50 + (d / 6) * 50}%"></span></span>
            <span class="bd">${describe(d)}</span></div>`;
        }).join("")}
          <div class="axis"><span>6 lower</span><span>original key</span><span>6 higher</span></div>
        </div>
        ${retest ? `<p>The second time you sang <em>${esc(songName(retest.song_id))}</em>, you were ${describe(retest.scores.primary.deviation)}.</p>` : ""}
      ` : `<p>We didn't get a scorable song recording this time, but your other answers are still helpful.</p>`}
      ${hb?.scores?.template ? `<p>You sang “Happy Birthday” in roughly <strong>${NOTE_NAMES[((Math.round(hb.scores.template.deviation) % 12) + 12) % 12]} major</strong>. It has no “correct” key, so it shows us where your voice is most comfortable.</p>` : ""}
      ${named != null ? `<div class="stat"><b>${named}/${S.naming.length}</b><span>notes named exactly (${near} within one semitone). Guessing would get about 2.</span></div>` : ""}
      ${anyUnverified ? `<p class="muted small">Note: the reference keys in this version are still being checked against the recordings, so treat these numbers as rough.</p>` : ""}
    </section>
    <section class="card">
      <h2>What this study is about</h2>
      <p>Very few people have <strong>perfect pitch</strong>, the ability to name a note out of the blue. But in 1994, Daniel Levitin found that many ordinary people sing pop songs within a semitone or two of the recorded key. That suggests almost everyone <em>remembers</em> pitch, even if they can't <em>name</em> it.</p>
      <p>Speakers of tone languages like Mandarin have perfect pitch far more often. Our question is whether language helps people <strong>name</strong> pitches, <strong>remember</strong> them, or both. Comparing your singing with your note naming and language background helps answer that.</p>
      <p>Please don't share details of the tasks with friends who might take part. It works best when people come in fresh.</p>
      <div class="row">
        <button class="btn ghost" id="dl">Download my data (JSON)</button>
      </div>
      <p class="muted small">Session ID: <code>${S.id}</code>. Keep this if you'd ever like your data withdrawn.</p>
    </section>`);
  $("#dl").onclick = () => {
    const blob = new Blob([JSON.stringify({ session_id: S.id, events: log }, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `sing-it-back_${S.id.slice(0, 8)}.json`; a.click();
  };
  S.mic?.close();
  window.onbeforeunload = null;
}

window.onbeforeunload = (e) => { if (S.step > 1 && S.step < 9) { e.preventDefault(); return ""; } };
window.addEventListener("error", (e) => { try { send(S, "client_error", { msg: String(e.message).slice(0, 300), step: S.step }); } catch {} });
welcome();
