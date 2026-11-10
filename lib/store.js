// Storage backend. Postgres (Neon serverless driver) when DATABASE_URL is set;
// otherwise, for local development only, newline-delimited JSON files in ./data/.
import { neon } from "@neondatabase/serverless";
import { appendFile, mkdir, readFile } from "node:fs/promises";

let sql = null;
const db = () => (sql ||= neon(process.env.DATABASE_URL));
const local = () => !process.env.DATABASE_URL && !process.env.VERCEL;

export const collecting = () => process.env.COLLECT_DATA === "true" && (!!process.env.DATABASE_URL || local());
export const studyMode = () => process.env.STUDY_MODE || "pilot";

export async function insertEvent(ev) {
  if (process.env.DATABASE_URL) {
    await db()`INSERT INTO events (session_id, kind, seq, client_time, app_version, study_mode, country, payload)
               VALUES (${ev.session_id}, ${ev.kind}, ${ev.seq}, ${ev.client_time}, ${ev.app_version}, ${ev.study_mode}, ${ev.country}, ${JSON.stringify(ev.payload)}::jsonb)`;
  } else if (local()) {
    await mkdir("data", { recursive: true });
    await appendFile("data/events.ndjson", JSON.stringify({ received_at: new Date().toISOString(), ...ev }) + "\n");
  } else throw new Error("No database configured");
}

export async function insertAudio(sessionId, trialId, buf) {
  if (process.env.DATABASE_URL) {
    await db()`INSERT INTO audio (session_id, trial_id, bytes, wav_b64) VALUES (${sessionId}, ${trialId}, ${buf.length}, ${buf.toString("base64")})`;
  } else if (local()) {
    await mkdir("data/audio", { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`data/audio/${sessionId}_${trialId}.wav`, buf);
  } else throw new Error("No database configured");
}

export async function eventsAfter(afterId = 0, limit = 2000) {
  if (process.env.DATABASE_URL) {
    return await db()`SELECT id, received_at, session_id, kind, seq, client_time, app_version, study_mode, country, payload
                      FROM events WHERE id > ${afterId} ORDER BY id LIMIT ${limit}`;
  }
  const txt = await readFile("data/events.ndjson", "utf8").catch(() => "");
  return txt.split("\n").filter(Boolean).map((l, i) => ({ id: i + 1, ...JSON.parse(l) })).filter((e) => e.id > afterId).slice(0, limit);
}
