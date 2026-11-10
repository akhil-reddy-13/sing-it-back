// Local development server: serves public/ and runs api/*.js like Vercel does.
//   COLLECT_DATA=true npm run dev     -> events go to ./data/events.ndjson
//   npm run dev                        -> demo mode (nothing saved)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

const PORT = +process.env.PORT || 3000;
const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const name = url.pathname.slice(5).replace(/[^a-z_-]/gi, "");
      const mod = await import(pathToFileURL(join(ROOT, "api", name + ".js")).href + "?t=" + Date.now());
      res.on("finish", () => console.log(new Date().toISOString().slice(11, 19), req.method, url.pathname, res.statusCode));
      return await mod.default(req, res);
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (p.endsWith("/")) p += "index.html";
    const file = join(ROOT, "public", p);
    if (!file.startsWith(join(ROOT, "public"))) throw new Error("forbidden");
    await stat(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(await readFile(file));
  } catch (e) {
    if (e.code !== "ENOENT") console.error(e);
    res.writeHead(e.code === "ENOENT" ? 404 : 500, { "content-type": "text/plain" });
    res.end(e.code === "ENOENT" ? "not found" : "error");
  }
}).listen(PORT, () => console.log(`Sing It Back on http://localhost:${PORT}  (collecting: ${process.env.COLLECT_DATA === "true"})`));
