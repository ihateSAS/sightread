import { createServer } from "node:http";
import { createConnection } from "node:net";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.mjs";
import { listAvailableRepos, prepareRepo, readCitedFile, runCommand } from "./lib/repo.mjs";
import { getRaceState, runRaceStream } from "./lib/race.mjs";
import { buildImportGraph, impactOf, hottestFiles, listSourceFiles } from "./lib/impact.mjs";

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
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".webm": "video/webm",
  ".ico": "image/x-icon",
};

const ALLOWED_THINKING = new Set(["low", "medium", "high"]);

// OpenClaw can drop to a fallback model without telling the caller, which would
// let a demo claim Kimi while a different model answered. Compare what came back
// with what we asked for, ignoring the provider prefix.
const modelLeaf = (m) => String(m || "").split("/").pop().toLowerCase();
export function modelMismatch(configured, actual) {
  if (!configured || !actual) return false;
  return modelLeaf(configured) !== modelLeaf(actual);
}
const graphCache = new Map();

// A question only earns a graph lookup when it is about change. Asking how
// something works stays a plain read; asking what a change breaks gets evidence.
// Verbs that mean "this file is the subject of a change or a usage question".
// Broad on purpose: the resolved path is the real gate, not the word.
const CHANGE_INTENT =
  /\b(break\w*|broke\w*|impact\w*|depend\w*|(?:uses|calls|imports|references)|affect\w*|safe to (?:change|edit|delete|remove)|refactor\w*|downstream|callers?|ripple\w*|delet\w*|remov\w*|renam\w*|mov(?:e|es|ing)|touch(?:es|ing)?|edit(?:s|ing)?|modif\w*|chang(?:e|es|ing)|replac\w*|extract(?:s|ing)?|inlin(?:e|es|ing)|drop(?:s|ping)?)\b/i;
// Hubs are only ever offered to a question that asks for them by name. A stray
// change verb is not a request for a list of the repository's busiest files.
const HOTSPOT_INTENT =
  /\b(which (?:files|file|modules?|parts)|load[- ]bearing|hotspots?|most (?:imported|depended on)|where (?:should|do) i start|what should i (?:read|look at))\b/i;
const FILE_MENTION =
  /(?:^|[\s`"'(])([\w.@/-]+\.(?:mjs|cjs|js|jsx|ts|tsx|py|go|rs|rb|java|kt|cs|php|swift|exs?|h|c|cc|cpp))(?=$|[\s`"'),:;?])/;

async function graphFor(repoPath) {
  const cached = graphCache.get(repoPath);
  if (cached && Date.now() - cached.at < 30000) return cached.graph;
  const graph = await buildImportGraph(repoPath);
  graphCache.set(repoPath, { graph, at: Date.now() });
  return graph;
}

const cleanPath = (p) =>
  String(p).trim().replace(/^[`"'(]+/, "").replace(/[`"'),:;?]+$/, "").replace(/^\.\//, "").replace(/^\/+/, "");

/**
 * Turns a question into evidence the model cannot make up: parsed dependents.
 * Returns null when the question is not about change, so normal reads stay cheap.
 */
export async function impactEvidence(repoPath, question, explicitPath) {
  // An explicit pick from the impact panel is already a file, so it counts as intent.
  const wantsImpact = Boolean(explicitPath) || CHANGE_INTENT.test(question);
  const wantsHubs = !explicitPath && HOTSPOT_INTENT.test(question);
  if (!wantsImpact && !wantsHubs) return null;

  const mentioned = (question.match(FILE_MENTION) || [])[1];
  const candidate = cleanPath(explicitPath || mentioned || "");

  // No resolved file, no impact list. A change verb alone is not evidence.
  if (!candidate) {
    if (!wantsHubs) return null;
    const graph = await graphFor(repoPath);
    return { mode: "hubs", hot: hottestFiles(graph, 8) };
  }

  if (!wantsImpact) return null;

  const graph = await graphFor(repoPath);
  if (!graph.files.includes(resolve(repoPath, candidate))) {
    // A path that does not exist is not a reason to inject a different answer.
    return wantsHubs ? { mode: "hubs", hot: hottestFiles(graph, 8) } : null;
  }
  return { mode: "impact", ...impactOf(graph, candidate) };
}

function impactPrompt(evidence) {
  if (evidence.mode === "hubs") {
    return [
      "Computed from real import statements, not from a model. Files with the most dependents here are:",
      ...evidence.hot.map((h) => `- ${h.path} (${h.dependents} importers)`),
      "Use this only if it answers the question. Do not add edges that are not listed.",
    ].join("\n");
  }
  const indirect = evidence.transitive.filter((t) => t.depth > 1);
  return [
    `Computed from real import statements. Changing ${evidence.target.path} affects:`,
    ...evidence.direct.map((d) => `- ${d.path}${d.line ? ` line ${d.line}` : ""} (direct importer)`),
    ...indirect.slice(0, 20).map((t) => `- ${t.path} (depth ${t.depth})`),
    evidence.direct.length === 0
      ? "Nothing here imports it, so nothing breaks from this change."
      : `Risk: ${evidence.risk.level}, ${evidence.direct.length} direct and ${indirect.length} indirect.`,
    "This graph is parsed, so do not invent or drop edges. Explain what breaks and cite file:line where the import sits. If the list is empty, say so plainly.",
  ].join("\n");
}

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

// A failed turn must not cost a process start. These two checks cover the
// failures we actually hit: no key, or a model OpenClaw has never heard of.
function cerebrasKeyProblem(cfg) {
  if (!/^cerebras\//i.test(cfg.model)) return null;
  if (process.env.CEREBRAS_API_KEY) return null;
  return {
    error: `CEREBRAS_API_KEY is not set, so ${cfg.model} cannot run. No turn was started.`,
    hint: "Add CEREBRAS_API_KEY to .env, restart the server, then retry.",
  };
}

async function probeCerebrasModel(cfg) {
  const r = await runCommand(cfg.agentBinary, ["config", "get", "models.providers.cerebras"]);
  if (r.code === -1) return { present: null };
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  const leaf = String(cfg.model).split("/").pop();
  const escaped = leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { present: new RegExp(`(^|[^A-Za-z0-9_-])${escaped}([^A-Za-z0-9_-]|$)`).test(text) };
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

async function askViaExec(cfg, repoPath, question, thinking, evidence) {
  const started = performance.now();
  const prompt = evidence
    ? `${question}\n\n<computed_impact>\n${impactPrompt(evidence)}\n</computed_impact>`
    : question;
  const r = await runCommand(
    cfg.agentBinary,
    [
      "agent", "exec", prompt,
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
      hint: "Run ./check-cerebras.sh, or start the warm gateway with `npm run gateway`.",
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
async function askViaGateway(cfg, repoPath, question, thinking, sessionId, evidence) {
  const started = performance.now();
  const prompt = evidence
    ? `Repository: ${repoPath}\n\n${question}\n\n<computed_impact>\n${impactPrompt(evidence)}\n</computed_impact>`
    : `Repository: ${repoPath}\n\n${question}`;
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
      hint: "Is the gateway running? Start it with `npm run gateway` (it sources .env).",
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

export function createAppServer({
  projectRoot = PROJECT_ROOT,
  reposDir = REPOS,
  publicDir = PUBLIC,
  modelProbe = probeCerebrasModel,
} = {}) {
  // Model registration changes only when someone patches OpenClaw, so the CLI
  // probe is cached instead of paid on every ask.
  let modelCheck = null;
  const checkModel = async (cfg) => {
    const now = Date.now();
    if (modelCheck && modelCheck.model === cfg.model && now - modelCheck.at < 5 * 60_000) {
      return modelCheck;
    }
    const result = await modelProbe(cfg).catch(() => ({ present: null }));
    modelCheck = { at: now, model: cfg.model, ...(result || { present: null }) };
    return modelCheck;
  };

  // Warm the probe so the first blocked ask answers from cache instead of
  // paying the CLI start itself.
  const bootCfg = getConfig();
  if (process.env.CEREBRAS_API_KEY && /^cerebras\//i.test(bootCfg.model)) {
    checkModel(bootCfg).catch(() => {});
  }

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
        // Source counts let the picker open on the repo with the most to show,
        // instead of whichever entry happens to be first in the directory.
        const sized = await Promise.all(
          repos.map(async (repo) => ({
            ...repo,
            files: (await listSourceFiles(repo.path).catch(() => [])).length,
          }))
        );
        return json(res, 200, { repos: sized });
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
        const { repo, question, thinking: rawThinking, sessionId, impactPath, impact: rawImpact } = await readBody(req);
        if (!question || !String(question).trim()) {
          return json(res, 400, { error: "question is required" });
        }
        const thinking = ALLOWED_THINKING.has(rawThinking) ? rawThinking : "low";
        const target = resolve(repo || projectRoot);
        const isDir = await stat(target).then((s) => s.isDirectory()).catch(() => false);
        if (!isDir) return json(res, 400, { error: `not a directory: ${target}` });

        const blocked = cerebrasKeyProblem(cfg);
        if (blocked) {
          return json(res, 400, {
            ok: false,
            error: blocked.error,
            hint: blocked.hint,
            configuredModel: cfg.model,
            impactDisabled: rawImpact === false,
          });
        }
        if (/^cerebras\//i.test(cfg.model)) {
          const probe = await checkModel(cfg);
          if (probe.present === false) {
            return json(res, 400, {
              ok: false,
              error: `OpenClaw has no model ${cfg.model}, so the turn cannot start.`,
              hint: "Apply ./openclaw/kimi-cerebras.patch.json5, restart the gateway, then retry.",
              configuredModel: cfg.model,
              impactDisabled: rawImpact === false,
            });
          }
        }

        const useGateway =
          cfg.transport === "gateway" ||
          (cfg.transport === "auto" && (await isGatewayReachable(cfg.gatewayPort)));

        // Evidence first, and only for change questions. Parsing is cached, so
        // this costs well under a millisecond on a warmed repo. Passing
        // impact:false answers from the model alone, which is what the demo
        // needs to show the graph beating a guess.
        const useImpact = rawImpact !== false;
        const impactStart = performance.now();
        const evidence = useImpact
          ? await impactEvidence(
              target,
              String(question).trim(),
              impactPath ? String(impactPath) : null
            ).catch(() => null)
          : null;
        const impactMs = evidence ? Math.round(performance.now() - impactStart) : null;

        const result = useGateway
          ? await askViaGateway(cfg, target, String(question).trim(), thinking, sessionId, evidence)
          : await askViaExec(cfg, target, String(question).trim(), thinking, evidence);

        result.impact = evidence;
        result.impactMs = impactMs;
        result.impactDisabled = !useImpact;
        result.impactUsed = Boolean(evidence);
        result.configuredModel = cfg.model;
        result.modelMismatch = modelMismatch(cfg.model, result.model);
        return json(res, result.ok ? 200 : 502, result);
      }

      // Impact map. Parsing a repo is the expensive part, so the graph is
      // cached briefly: repeat lookups are instant while editing.
      if (req.method === "GET" && url.pathname === "/api/impact") {
        const repo = resolve(url.searchParams.get("repo") || projectRoot);
        const target = url.searchParams.get("path");
        const isDir = await stat(repo).then((s) => s.isDirectory()).catch(() => false);
        if (!isDir) return json(res, 400, { error: `not a directory: ${repo}` });

        const graph = await graphFor(repo);

        if (!target) {
          return json(res, 200, {
            ok: true,
            hot: hottestFiles(graph),
            stats: { files: graph.files.length, imports: graph.imports, languages: graph.languages },
          });
        }
        const result = impactOf(graph, target);
        result.hot = hottestFiles(graph);
        result.stats = { files: graph.files.length, imports: graph.imports, languages: graph.languages };
        return json(res, 200, result);
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
