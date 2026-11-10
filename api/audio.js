// Optional raw audio upload (16 kHz mono WAV), only sent when the participant
// ticked the separate audio-consent box. Stored privately in Postgres.
import { collecting, insertAudio } from "../lib/store.js";
import { rawBody, send, UUID_RE } from "../lib/http.js";

const MAX = 1_500_000; // ~45 s at 16 kHz / 16-bit

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  if (!collecting() || process.env.COLLECT_AUDIO !== "true") return send(res, 403, { error: "audio not collected" });
  const url = new URL(req.url, "http://x");
  const sid = url.searchParams.get("session_id") || "", trial = url.searchParams.get("trial") || "";
  if (!UUID_RE.test(sid) || !/^\d{1,2}_\d$/.test(trial)) return send(res, 400, { error: "bad params" });
  let buf;
  try { buf = await rawBody(req, MAX); } catch (e) { return send(res, e.status || 400, { error: "bad body" }); }
  if (buf.length > MAX || buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE")
    return send(res, 400, { error: "not a wav" });
  try { await insertAudio(sid, trial, buf); } catch (e) { console.error(e); return send(res, 500, { error: "storage" }); }
  send(res, 200, { ok: true });
}
