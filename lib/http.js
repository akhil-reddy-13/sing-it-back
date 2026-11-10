// Small helpers shared by the API routes.
export async function rawBody(req, max) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw Object.assign(new Error("too large"), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks);
}
export async function jsonBody(req, max) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const buf = await rawBody(req, max);
  if (buf.length > max) throw Object.assign(new Error("too large"), { status: 413 });
  return JSON.parse(buf.toString("utf8"));
}
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(obj));
}
