import { collecting, studyMode, insertEvent } from "../lib/store.js";
import { jsonBody, send, UUID_RE } from "../lib/http.js";

const KINDS = new Set(["session_start", "mic_check", "familiarity", "trial", "trial_skipped", "speech", "range", "naming", "questionnaire", "complete", "client_error"]);
const MAX = 2_000_000; // one trial with a 35 s pitch track is ~120 kB

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  if (!collecting()) return send(res, 403, { error: "not collecting" });
  let ev;
  try { ev = await jsonBody(req, MAX); } catch (e) { return send(res, e.status || 400, { error: "bad body" }); }
  if (!ev || !UUID_RE.test(ev.session_id || "") || !KINDS.has(ev.kind) || !Number.isInteger(ev.seq) || typeof ev.payload !== "object" || ev.payload === null)
    return send(res, 400, { error: "invalid event" });
  const clientTime = Date.parse(ev.client_time) ? new Date(ev.client_time).toISOString() : null;
  try {
    await insertEvent({
      session_id: ev.session_id, kind: ev.kind, seq: ev.seq, client_time: clientTime,
      app_version: String(ev.app_version || "").slice(0, 20), study_mode: studyMode(),
      country: String(req.headers["x-vercel-ip-country"] || "").slice(0, 4) || null,
      payload: ev.payload,
    });
  } catch (e) {
    console.error("insert failed", e);
    return send(res, 500, { error: "storage" });
  }
  send(res, 200, { ok: true });
}
