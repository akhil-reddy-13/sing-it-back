// Researcher export:  GET /api/export?after=0   with header  Authorization: Bearer $ADMIN_TOKEN
// Returns newline-delimited JSON, 2000 events per page. analysis/fetch_data.py pages through it.
import { timingSafeEqual } from "node:crypto";
import { eventsAfter } from "../lib/store.js";
import { send } from "../lib/http.js";

function authorized(req) {
  const want = process.env.ADMIN_TOKEN || "";
  const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (want.length < 24 || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export default async function handler(req, res) {
  if (!authorized(req)) return send(res, 401, { error: "unauthorized" });
  const after = Math.max(0, parseInt(new URL(req.url, "http://x").searchParams.get("after") || "0", 10) || 0);
  const rows = await eventsAfter(after, 2000);
  res.statusCode = 200;
  res.setHeader("content-type", "application/x-ndjson");
  res.setHeader("cache-control", "no-store");
  res.end(rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}
