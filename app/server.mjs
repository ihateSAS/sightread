import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "public");
const REPOS = join(HERE, "..", "repos");
const PORT = (() => {
  const n = Number(process.env.PORT);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 8787;
})();
const MODEL = process.env.SIGHTREAD_MODEL || "cerebras/gpt-oss-120b";

const agentBinary = process.env.OPENCLAW_BIN || "openclaw";

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req, limit = 1 << 20) {
  return new Promise((res, rej) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        rej(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        res(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        rej(new Error("invalid JSON"));
      }
    });
    req.on("error", rej);
  });
}

// Streams a child process and returns { code, stdout, stderr }.
function run(cmd, args, opts = {}) {
  return new Promise((res) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => res({ code: -1, stdout: out, stderr: String(e) }));
    child.on("close", (code) => res({ code, stdout: out, stderr: err }));
  });
}

function slugFromUrl(url) {
  const clean = url.trim().replace(/\.git$/, "");
  const m = clean.match(/(?:github\.com[/:])([^/]+)\/([^/?#]+)/i) || clean.match(/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return `${m[1]}__${m[2]}`.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 80);
}

async function prepareRepo(url) {
  const slug = slugFromUrl(url);
  if (!slug) throw new Error("could not parse a repo name from that URL");
  const dest = join(REPOS, slug);
  const exists = await stat(dest).then(() => true).catch(() => false);
  if (exists) return { path: dest, slug, cloned: false };

  const r = await run("git", ["clone", "--depth", "1", "--quiet", url.trim(), dest], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (r.code !== 0) throw new Error(`git clone failed: ${r.stderr.slice(0, 400)}`);
  return { path: dest, slug, cloned: true };
}

async function ask(repoPath, question) {
  const started = performance.now();
  const r = await run(
    agentBinary,
    [
      "agent", "exec", question,
      "--cwd", repoPath,
      "--model", MODEL,
      "--thinking", "low",
      "--timeout", "300",
      "--json",
    ],
    { cwd: repoPath }
  );
  const elapsedMs = Math.round(performance.now() - started);
  const raw = r.stdout.trim();

  let envelope = null;
  const first = raw.indexOf("{");
  if (first !== -1) {
    try { envelope = JSON.parse(raw.slice(first)); } catch { /* keep null */ }
  }
  if (!envelope) {
    return {
      ok: false, elapsedMs,
      error: (r.stderr || raw || "no output").slice(0, 800),
      hint: "If this says the model is unavailable, run ./check-cerebras.sh and set --model via SIGHTREAD_MODEL.",
    };
  }
  return {
    ok: envelope.ok !== false,
    final: envelope.final ?? "",
    usage: envelope.usage ?? null,
    toolSummary: envelope.toolSummary ?? null,
    assistantTurns: envelope.assistantTurns ?? null,
    model: envelope.model ?? MODEL,
    elapsedMs,
    error: envelope.error?.message ?? null,
  };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await readFile(join(PUBLIC, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      const v = await run(agentBinary, ["--version"]);
      return json(res, 200, {
        openclaw: v.stdout.trim() || v.stderr.trim() || "not found",
        model: MODEL,
        keyPresent: Boolean(process.env.CEREBRAS_API_KEY),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/prepare") {
      const { url: repoUrl } = await readBody(req);
      if (!repoUrl) return json(res, 400, { error: "url is required" });
      const prepared = await prepareRepo(repoUrl);
      return json(res, 200, prepared);
    }

    if (req.method === "POST" && url.pathname === "/api/ask") {
      const { repo, question } = await readBody(req);
      if (!question) return json(res, 400, { error: "question is required" });
      const target = resolve(repo || REPOS);
      const isDir = await stat(target).then((s) => s.isDirectory()).catch(() => false);
      if (!isDir) return json(res, 400, { error: `not a directory: ${target}` });
      const result = await ask(target, question);
      return json(res, result.ok ? 200 : 502, result);
    }

    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`Sightread on http://localhost:${PORT}`);
  console.log(`model: ${MODEL}`);
  if (!process.env.CEREBRAS_API_KEY) {
    console.warn("warning: CEREBRAS_API_KEY is not set — agent turns will fail");
  }
});
