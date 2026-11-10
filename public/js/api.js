// Event logging with an offline-safe queue. Every step of a session is sent as an
// append-only event, so partial sessions are kept and nothing is overwritten.
const QKEY = "sib_queue_v1";
let queue = [];
try { queue = JSON.parse(localStorage.getItem(QKEY) || "[]"); } catch { queue = []; }
const save = () => { try { localStorage.setItem(QKEY, JSON.stringify(queue.slice(-50))); } catch {} };

let seq = 0, flushing = false;
export const log = []; // everything sent this session (for the participant's own download)

export async function getConfig() {
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    if (r.ok) return await r.json();
  } catch {}
  return { collecting: false, mode: "offline", irb_protocol: null, audio: false };
}

export function send(session, kind, payload) {
  const ev = { session_id: session.id, kind, seq: seq++, client_time: new Date().toISOString(), app_version: session.app_version, payload };
  log.push(ev);
  if (!session.collecting) return Promise.resolve();
  queue.push(ev); save();
  return flush();
}

export async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length) {
      const ev = queue[0];
      const body = JSON.stringify(ev);
      // keepalive only for small events: Chrome caps keepalive bodies (~64 kB total in flight)
      // and silently stalls past it. A timeout keeps one stuck request from blocking the queue.
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
      let r;
      try {
        r = await fetch("/api/event", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: body.length < 8000, signal: ctl.signal });
      } finally { clearTimeout(timer); }
      if (!r.ok && r.status >= 500) throw new Error("server " + r.status);
      queue.shift(); save(); // 4xx = rejected for good; don't retry forever
    }
  } catch {
    setTimeout(() => { flushing = false; flush(); }, 4000);
    return;
  }
  flushing = false;
}

export async function uploadAudio(session, trialId, wavBlob) {
  if (!session.collecting || !session.consent?.audio) return;
  try {
    await fetch(`/api/audio?session_id=${encodeURIComponent(session.id)}&trial=${encodeURIComponent(trialId)}`, {
      method: "POST", headers: { "content-type": "application/octet-stream" }, body: wavBlob,
    });
  } catch {}
}

window.addEventListener("online", () => flush());
