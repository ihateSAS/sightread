import { createServer } from "node:http";
import { createConnection } from "node:net";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.mjs";
import { listAvailableRepos, prepareRepo, readCitedFile, runCommand } from "./lib/repo.mjs";
import { getRaceState, runRaceStream } from "./lib/race.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..");
const PUBLIC = join(HERE, "public");
const REPOS = join(PROJECT_ROOT, "repos");

loadEnv(PROJECT_ROOT);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ico": "image/x-icon",
};

const ALLOWED_THINKING = new Set(["low", "medium", "high"]);

function getConfig() {
  const n = Number(process.env.PORT);
  return {
    port: Number.isInteger(n) && n > 0 && n < 65536 ? n : 8787,
    model: process.env.SIGHTREAD_MODEL || "cerebras/gpt-oss-120b",
    transport: process.env.SIGHTREAD_TRANSPORT || "auto",
    agent: process.env.SIGHTREAD_AGENT || "sightread",
    agentBinary: process.env.OPENCLAW_BIN || "openclaw",
    gatewayPort: Number(process.env.OPENCLAW_GATEWAY_PORT) || 18789,
  };
}

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
      } else {
        chunks.push(c);
      }
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

function isGatewayReachable(port, timeoutMs = 250) {
  return new Promise((resolveDone) => {
    const sock = createConnection({ host: "127.0.0.1", port });
    const done = (ok) => {
      sock.removeAllListeners();
      sock.destroy();
      resolveDone(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => done(true));
    sock.on("timeout", () => done(false));
    sock.on("error", () => done(false));
  });
}

function parseJsonTail(raw) {
  const trimmed = String(raw || "").trim();
  const first = trimmed.indexOf("{");
  if (first === -1) return null;
  try {
    return JSON.parse(trimmed.slice(first));
  } catch {
    return null;
  }
}

function extractTraceTools(trace) {
  if (!Array.isArray(trace)) return null;
  const names = [];
  const seen = new Set();
  for (const step of trace) {
    const name =
      typeof step === "string"
        ? step
        : step?.toolName || step?.tool || step?.name || step?.type;
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return { calls: trace.length, tools: names };
}

async function askViaExec(cfg, repoPath, question, thinking) {
  const started = performance.now();
  const r = await runCommand(
    cfg.agentBinary,
    [
      "agent", "exec", question,
      "--cwd", repoPath,
      "--model", cfg.model,
      "--thinking", thinking,
      "--timeout", "300",
      "--json",
    ],
    { cwd: repoPath }
  );
  const elapsedMs = Math.round(performance.now() - started);
  const envelope = parseJsonTail(r.stdout);

  if (!envelope) {
    return {
      ok: false,
      elapsedMs,
      transport: "exec",
      error: (r.stderr || r.stdout || "no output from openclaw").slice(0, 800),
      hint: "Run ./check-cerebras.sh or start the warm gateway (`openclaw gateway start`).",
    };
  }
  return {
    ok: envelope.ok !== false,
    final: envelope.final ?? "",
    usage: envelope.usage ?? null,
    toolSummary: envelope.toolSummary ?? null,
    assistantTurns: envelope.assistantTurns ?? null,
    sessionId: envelope.sessionId ?? null,
    model: envelope.model ?? cfg.model,
    transport: "exec",
    elapsedMs,
    error: envelope.error?.message ?? null,
  };
}

// Warm path: talk to an already-running gateway instead of paying process
// start-up on every question. Measured ~2-3s faster per turn.
async function askViaGateway(cfg, repoPath, question, thinking, sessionId) {
  const started = performance.now();
  const prompt = `Repository: ${repoPath}\n\n${question}`;
  const args = [
    "agent", "-m", prompt,
    "--agent", cfg.agent,
    "--model", cfg.model,
    "--thinking", thinking,
    "--timeout", "300",
    "--json",
  ];
  if (sessionId && /^[a-zA-Z0-9_.-]{1,80}$/.test(sessionId)) {
    args.push("--session-id", sessionId);
  }
  const r = await runCommand(cfg.agentBinary, args);
  const elapsedMs = Math.round(performance.now() - started);
  const env = parseJsonTail(r.stdout);

  if (!env) {
    return {
      ok: false,
      elapsedMs,
      transport: "gateway",
      error: (r.stderr || r.stdout || "no output from gateway").slice(0, 800),
      hint: "Is the gateway running? Try: openclaw gateway start",
    };
  }
  const meta = env.result?.meta ?? {};
  const agentMeta = meta.agentMeta ?? {};
  const toolSummary =
    meta.toolSummary ||
    extractTraceTools(meta.executionTrace) ||
    null;

  return {
    ok: env.status === "ok",
    final: env.result?.payloads?.[0]?.text ?? env.final ?? "",
    usage: agentMeta.usage
      ? { input: agentMeta.usage.input, output: agentMeta.usage.output }
      : (env.usage ?? null),
    toolSummary,
    assistantTurns: meta.assistantTurns ?? agentMeta.turns ?? (toolSummary ? toolSummary.calls + 1 : 1),
    sessionId: meta.sessionId ?? agentMeta.sessionId ?? sessionId ?? null,
    model: agentMeta.model ?? cfg.model,
    transport: "gateway",
    elapsedMs,
    agentMs: meta.durationMs ?? null,
    error: env.error?.message ?? null,
  };
}

export function createAppServer({ projectRoot = PROJECT_ROOT, reposDir = REPOS, publicDir = PUBLIC } = {}) {
  return createServer(async (req, res) => {
    const cfg = getConfig();
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

      // Static assets from public/
      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        const rel = url.pathname === "/" || url.pathname === "/race"
          ? "index.html"
          : decodeURIComponent(url.pathname.slice(1));
        const safe = rel && !rel.includes("..") && !rel.startsWith("/") && !rel.includes("\\");
        if (safe) {
          try {
            const body = await readFile(join(publicDir, rel));
            const ext = rel.includes(".") ? "." + rel.split(".").pop().toLowerCase() : "";
            res.writeHead(200, {
              "content-type": TYPES[ext] || "application/octet-stream",
              "cache-control": ext === ".html" ? "no-store" : "public, max-age=86400",
            });
            return res.end(body);
          } catch {
            // fall through to 404
          }
        }
      }

      if (req.method === "GET" && url.pathname === "/api/health") {
        const [v, gatewayUp] = await Promise.all([
          runCommand(cfg.agentBinary, ["--version"]),
          isGatewayReachable(cfg.gatewayPort),
        ]);
        const effectiveTransport =
          cfg.transport === "auto" ? (gatewayUp ? "gateway" : "exec") : cfg.transport;
        return json(res, 200, {
          ok: true,
          openclaw: v.stdout.trim() || v.stderr.trim() || "not found",
          model: cfg.model,
          agent: cfg.agent,
          transport: cfg.transport,
          effectiveTransport,
          gatewayUp,
          keyPresent: Boolean(process.env.CEREBRAS_API_KEY),
          openrouterKeyPresent: Boolean(process.env.OPENROUTER_API_KEY),
        });
      }

      if (req.method === "GET" && url.pathname === "/api/repos") {
        const repos = await listAvailableRepos(projectRoot, reposDir);
        return json(res, 200, { repos });
      }

      if (req.method === "GET" && url.pathname === "/api/file") {
        const repo = url.searchParams.get("repo") || projectRoot;
        const filePath = url.searchParams.get("path");
        const line = url.searchParams.get("line");
        const endLine = url.searchParams.get("end");
        try {
          const snippet = await readCitedFile({
            repoInput: repo,
            filePath,
            line,
            endLine,
            projectRoot,
            reposDir,
          });
          return json(res, 200, snippet);
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }

      if (req.method === "POST" && url.pathname === "/api/prepare") {
        const { url: repoUrl } = await readBody(req);
        if (!repoUrl) return json(res, 400, { error: "url is required" });
        try {
          const prepared = await prepareRepo(repoUrl, reposDir);
          return json(res, 200, prepared);
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }

      if (req.method === "POST" && url.pathname === "/api/ask") {
        const { repo, question, thinking: rawThinking, sessionId } = await readBody(req);
        if (!question || !String(question).trim()) {
          return json(res, 400, { error: "question is required" });
        }
        const thinking = ALLOWED_THINKING.has(rawThinking) ? rawThinking : "low";
        const target = resolve(repo || projectRoot);
        const isDir = await stat(target).then((s) => s.isDirectory()).catch(() => false);
        if (!isDir) return json(res, 400, { error: `not a directory: ${target}` });

        const useGateway =
          cfg.transport === "gateway" ||
          (cfg.transport === "auto" && (await isGatewayReachable(cfg.gatewayPort)));

        const result = useGateway
          ? await askViaGateway(cfg, target, String(question).trim(), thinking, sessionId)
          : await askViaExec(cfg, target, String(question).trim(), thinking);

        return json(res, result.ok ? 200 : 502, result);
      }

      if (req.method === "GET" && url.pathname === "/api/race/state") {
        return json(res, 200, getRaceState());
      }

      if (req.method === "POST" && url.pathname === "/api/race") {
        const body = await readBody(req);
        return await runRaceStream(req, res, body);
      }

      return json(res, 404, { error: "not found" });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cfg = getConfig();
  const server = createAppServer();
  server.listen(cfg.port, () => {
    console.log(`Sightread on http://localhost:${cfg.port}`);
    console.log(`model: ${cfg.model} (transport: ${cfg.transport})`);
    if (!process.env.CEREBRAS_API_KEY) {
      console.warn("warning: CEREBRAS_API_KEY is not set — agent turns will fail");
    }
  });
}
