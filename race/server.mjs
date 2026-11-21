import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/lib/env.mjs";
import { getRaceState, getSides, runRaceStream } from "../app/lib/race.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..");
loadEnv(PROJECT_ROOT);

const PORT = Number(process.env.RACE_PORT) || 8788;

function readBody(req) {
  return new Promise((resolveDone, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolveDone(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const html = await readFile(join(HERE, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(html);
  }

  if (req.method === "GET" && url.pathname === "/icon.png") {
    const img = await readFile(join(PROJECT_ROOT, "app", "public", "icon.png"));
    res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
    return res.end(img);
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    const payload = JSON.stringify(getRaceState());
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(payload),
    });
    return res.end(payload);
  }

  if (req.method === "POST" && url.pathname === "/api/race") {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: e.message }));
    }
    return await runRaceStream(req, res, body);
  }

  res.writeHead(404);
  res.end("not found");
});

const SIDES = getSides();
server.listen(PORT, () => {
  console.log(`race page: http://localhost:${PORT}`);
  console.log(`  cerebras   ${SIDES.cerebras.model()}  ${SIDES.cerebras.key() ? "ready" : "NO KEY"}`);
  console.log(`  openrouter ${SIDES.openrouter.model()}  ${SIDES.openrouter.key() ? "ready" : "NO KEY (right pane will show as stub)"}`);
});
