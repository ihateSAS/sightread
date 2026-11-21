import { createServer } from "node:http";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.mjs";
import { listAvailableRepos, prepareRepo, readCitedFile, runCommand } from "./lib/repo.mjs";
import { getRaceState, runRaceStream } from "./lib/race.mjs";
import { buildImportGraph, impactOf, hottestFiles, listSourceFiles } from "./lib/impact.mjs";
import { createAcpClient } from "./lib/acp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..");
const PUBLIC = join(HERE, "public");
const REPOS = join(PROJECT_ROOT, "repos");

loadEnv(PROJECT_ROOT);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
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

// OpenClaw retries a rate-limited provider turn on its own ladder, which can
// run for ten minutes while the browser waits on an answer that will fail.
// Bound the turn here so every request ends with something the UI can show.
// Observed good turns land in 1.4-7.2s, so 45s leaves room for a slow one and
// still bounds a rate-limited turn well short of the two minutes it would
// otherwise spend waiting out 60s retries.
const ASK_DEADLINE_MS = Math.max(20_000, Number(process.env.SIGHTREAD_DEADLINE_MS) || 45_000);

// Cerebras counts the prompt and the requested output against its 30k
// tokens/minute budget, so a 429 is a normal outcome, not an outage. Recognise
// it in whatever the CLI hands back so the app can say that instead of
// "502 unknown error".
const RATE_LIMIT = /(token_quota_exceeded|tokens per minute|too many tokens|rate limit|too many requests|\b429\b)/i;
function rateLimitInfo(text) {
  const raw = String(text || "");
  if (!RATE_LIMIT.test(raw)) return null;
  const after = /retry[- ]after:?\s*(\d+)/i.exec(raw);
  return { retryAfter: after ? Number(after[1]) : 60 };
}

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
  // Path only: the header already says these are importers, and every token
  // here is charged against a 30k/minute budget that the whole turn shares.
  return [
    `Computed from real import statements. Changing ${evidence.target.path} affects:`,
    ...evidence.direct.map((d) => `- ${d.path}${d.line ? `:${d.line}` : ""}`),
    ...indirect.slice(0, 20).map((t) => `- ${t.path} (depth ${t.depth})`),
    evidence.direct.length === 0
      ? "Nothing here imports it, so nothing breaks from this change."
      : `Risk: ${evidence.risk.level}, ${evidence.direct.length} direct and ${indirect.length} indirect.`,
    // The graph is complete, so a tool round trip would only re-read what is
    // already on the page. Saying that here keeps the aided turn to one call.
    "This graph is parsed and complete, so do not invent or drop edges. Answer from this list directly instead of reading the repository, name the affected paths exactly as listed, and cite the line where each direct import sits. If the list is empty, say so plainly.",
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

// ACP never reports which model won a turn, and the sightread agent has a
// fallback chain, so the label has to come from somewhere honest. The provider's
// own model list is that signal: cache it briefly and name the model the turn
// can actually run. The moment Kimi appears there, the page says Kimi.
let modelListCache = { at: 0, ids: null };

async function cerebrasModelIds() {
  if (Date.now() - modelListCache.at < 60_000) return modelListCache.ids;
  try {
    const res = await fetch("https://api.cerebras.ai/v1/models", {
      headers: { authorization: `Bearer ${process.env.CEREBRAS_API_KEY}` },
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    modelListCache = {
      at: Date.now(),
      ids: Array.isArray(data?.data) ? data.data.map((m) => m.id) : null,
    };
  } catch {
    // Unknown is not the same as missing: keep claiming the configured model
    // rather than inventing a fallback the turn may not have used.
    modelListCache = { at: Date.now(), ids: null };
  }
  return modelListCache.ids;
}

async function effectiveModel(cfg) {
  if (!/^cerebras\//i.test(cfg.model)) return cfg.model;
  const ids = await cerebrasModelIds();
  if (!Array.isArray(ids)) return cfg.model;
  const leaf = String(cfg.model).split("/").pop();
  if (ids.includes(leaf)) return cfg.model;
  return process.env.SIGHTREAD_FALLBACK_MODEL || "cerebras/qwen-3.8-27b";
}

// The agent config names Kimi as primary so capacity landing needs no edit. But
// every turn that tries a model the provider does not serve yet pays seconds of
// retry before the fallback answers, so at boot the live chain is reconciled to
// what the provider actually lists. Replacing the key and restarting is enough:
// the first boot that sees Kimi promotes it back.
async function syncAgentModel(cfg) {
  if (!/^cerebras\//i.test(cfg.model)) return { changed: false, reason: "not cerebras" };
  const ids = await cerebrasModelIds();
  if (!Array.isArray(ids)) return { changed: false, reason: "provider list unavailable" };

  const fallback = process.env.SIGHTREAD_FALLBACK_MODEL || "cerebras/qwen-3.8-27b";
  const live = ids.includes(String(cfg.model).split("/").pop());
  const desired = live
    ? { primary: cfg.model, fallbacks: [fallback, "cerebras/gpt-oss-120b"] }
    : { primary: fallback, fallbacks: ["cerebras/gpt-oss-120b"] };

  const current = await runCommand(cfg.agentBinary, [
    "config", "get", `agents.entries.${cfg.agent}.model`,
  ]);
  let currentPrimary = null;
  try {
    currentPrimary = JSON.parse(String(current.stdout || "{}")).primary ?? null;
  } catch {
    currentPrimary = null;
  }
  // Compare the primary exactly: the fallback names are present in both forms,
  // so matching on them would call a Kimi-primary chain settled.
  if (currentPrimary === desired.primary) return { changed: false, primary: desired.primary };

  const write = await runCommand(cfg.agentBinary, [
    "config", "set", `agents.entries.${cfg.agent}.model`, JSON.stringify(desired),
  ]);
  return {
    changed: write.code === 0,
    primary: desired.primary,
    kimiLive: live,
    error: write.code === 0 ? null : (write.stderr || "").slice(0, 200),
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

// Some gateway envelopes carry an empty usage object. Passing that through made
// the stats strip print 0→0 tokens, which reads as a measured zero.
// A turn that produced no envelope: deadline, rate limit, or a broken CLI. Both
// transports report it the same way so the UI has one shape to render.
function failedTurn({ transport, elapsedMs, r, fallback, hint }) {
  const raw = `${r.stderr || ""}\n${r.stdout || ""}`;
  const limited = rateLimitInfo(raw);
  return {
    ok: false,
    elapsedMs,
    transport,
    timedOut: Boolean(r.timedOut),
    rateLimited: Boolean(limited),
    retryAfter: limited?.retryAfter ?? null,
    error: r.timedOut
      ? `The turn was still running after ${Math.round(ASK_DEADLINE_MS / 1000)}s, so it was stopped.`
      : (raw.trim() || fallback).slice(0, 800),
    hint: r.timedOut
      ? "A rate-limited turn can outlive the deadline. Retry once the provider's minute window clears."
      : hint,
  };
}

function usableUsage(u) {
  if (!u || typeof u !== "object") return null;
  const input = typeof u.input === "number" ? u.input : null;
  const output = typeof u.output === "number" ? u.output : null;
  return input === null && output === null ? null : { input, output };
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

// The unaided turn is the baseline, so it has to be a real attempt. Handing it
// only a repository path invites "I have no file access", which inflates the
// gap without testing the graph. This asks for a best-effort answer and for
// guesses to be marked as guesses.
function unaidedPrompt(question) {
  return `You have no repository access and no tools this turn. Answer from what you know about this project and its conventions: name the specific files you believe would be affected, and mark anything you are guessing at.\n\n${question}`;
}

async function askViaExec(cfg, repoPath, question, thinking, evidence) {
  const started = performance.now();
  const prompt = evidence
    ? `${question}\n\n<computed_impact>\n${impactPrompt(evidence)}\n</computed_impact>`
    : unaidedPrompt(question);
  const r = await runCommand(
    cfg.agentBinary,
    [
      "agent", "exec", prompt,
      "--cwd", repoPath,
      "--model", cfg.model,
      "--thinking", thinking,
      "--timeout", String(Math.round(ASK_DEADLINE_MS / 1000)),
      "--json",
    ],
    { cwd: repoPath, timeoutMs: ASK_DEADLINE_MS }
  );
  const elapsedMs = Math.round(performance.now() - started);
  const envelope = parseJsonTail(r.stdout);

  if (!envelope) {
    return failedTurn({
      transport: "exec",
      elapsedMs,
      r,
      fallback: "no output from openclaw",
      hint: "Run ./check-cerebras.sh, or start the warm gateway with `npm run gateway`.",
    });
  }
  const limited = rateLimitInfo(`${envelope.error?.message || ""}\n${r.stderr}`);
  return {
    rateLimited: Boolean(limited),
    retryAfter: limited?.retryAfter ?? null,
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
    : `Repository: ${repoPath}\n\n${unaidedPrompt(question)}`;
  // Every question is independent unless the caller explicitly asks to follow
  // up. Without an id OpenClaw falls back to the agent's main session, so each
  // ask would replay every earlier turn's history and inflate the prompt.
  const sid = /^[a-zA-Z0-9_.-]{1,80}$/.test(String(sessionId || "")) ? sessionId : randomUUID();
  const args = [
    "agent", "-m", prompt,
    "--agent", cfg.agent,
    "--model", cfg.model,
    "--thinking", thinking,
    "--timeout", String(Math.round(ASK_DEADLINE_MS / 1000)),
    "--json",
    "--session-id", sid,
  ];
  const r = await runCommand(cfg.agentBinary, args, { timeoutMs: ASK_DEADLINE_MS + 5_000 });
  const elapsedMs = Math.round(performance.now() - started);
  const env = parseJsonTail(r.stdout);

  if (!env) {
    return failedTurn({
      transport: "gateway",
      elapsedMs,
      r,
      fallback: "no output from gateway",
      hint: "Is the gateway running? Start it with `npm run gateway` (it sources .env).",
    });
  }
  const meta = env.result?.meta ?? {};
  const agentMeta = meta.agentMeta ?? {};
  const limited = rateLimitInfo(`${env.error?.message || ""}\n${r.stderr}`);
  const toolSummary =
    meta.toolSummary ||
    extractTraceTools(meta.executionTrace) ||
    null;

  return {
    rateLimited: Boolean(limited),
    retryAfter: limited?.retryAfter ?? null,
    ok: env.status === "ok",
    final: env.result?.payloads?.[0]?.text ?? env.final ?? "",
    usage: usableUsage(agentMeta?.usage) ?? usableUsage(env.usage),
    toolSummary,
    assistantTurns: meta.assistantTurns ?? agentMeta.turns ?? (toolSummary ? toolSummary.calls + 1 : 1),
    sessionId: meta.sessionId ?? agentMeta.sessionId ?? sid,
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

  // Shared by the JSON and streaming ask routes: same validation, same evidence,
  // so the two cannot disagree about what a question is allowed to see.
  async function prepareAsk(cfg, body) {
    const { repo, question, thinking: rawThinking, impactPath, impact: rawImpact } = body;
    if (!question || !String(question).trim()) {
      return { error: 400, body: { error: "question is required" } };
    }
    // Which model will actually answer is resolved first: the configured one may
    // be missing from the provider, in which case the fallback answers and the
    // turn has to be shaped for that model, not the configured one.
    const model = await effectiveModel(cfg);

    // Qwen on Cerebras can spend a short answer's whole budget on hidden
    // reasoning and return no text at all, so this model only answers reliably
    // with thinking off. Other models keep the level the page selects.
    const thinking = /qwen/i.test(model)
      ? "off"
      : ALLOWED_THINKING.has(rawThinking)
        ? rawThinking
        : "low";
    const target = resolve(repo || projectRoot);
    const isDir = await stat(target).then((s) => s.isDirectory()).catch(() => false);
    if (!isDir) return { error: 400, body: { error: `not a directory: ${target}` } };

    const blocked = cerebrasKeyProblem(cfg);
    if (blocked) {
      return {
        error: 400,
        body: {
          ok: false,
          error: blocked.error,
          hint: blocked.hint,
          configuredModel: cfg.model,
          impactDisabled: rawImpact === false,
        },
      };
    }
    if (/^cerebras\//i.test(cfg.model)) {
      const probe = await checkModel(cfg);
      if (probe.present === false) {
        return {
          error: 400,
          body: {
            ok: false,
            error: `OpenClaw has no model ${cfg.model}, so the turn cannot start.`,
            hint: "Apply ./openclaw/kimi-cerebras.patch.json5, restart the gateway, then retry.",
            configuredModel: cfg.model,
            impactDisabled: rawImpact === false,
          },
        };
      }
    }

    // Evidence first, and only for change questions. Parsing is cached, so this
    // costs well under a millisecond on a warmed repo. Passing impact:false
    // answers from the model alone, which is what the demo compares against.
    const useImpact = rawImpact !== false;
    const impactStart = performance.now();
    const evidence = useImpact
      ? await impactEvidence(target, String(question).trim(), impactPath ? String(impactPath) : null).catch(
          () => null
        )
      : null;

    return {
      question: String(question).trim(),
      target,
      model,
      thinking,
      useImpact,
      evidence,
      impactMs: evidence ? Math.round(performance.now() - impactStart) : null,
    };
  }

  // The ACP bridge is spawned once and reused; the first spawn costs ~1.8s.
  const acp = createAcpClient({
    bin: process.env.OPENCLAW_BIN || "openclaw",
    agent: process.env.SIGHTREAD_AGENT || "sightread",
  });

  // Warm the probe so the first blocked ask answers from cache instead of
  // paying the CLI start itself.
  const bootCfg = getConfig();
  if (process.env.CEREBRAS_API_KEY && /^cerebras\//i.test(bootCfg.model)) {
    checkModel(bootCfg).catch(() => {});
  }

  const server = createServer(async (req, res) => {
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
        const body = await readBody(req);
        const prep = await prepareAsk(cfg, body);
        if (prep.error) return json(res, prep.error, prep.body);
        const { question, target, thinking, useImpact, evidence, impactMs } = prep;
        const sessionId = body.sessionId;
        // Run the model that can answer, not the configured one: passing Kimi to
        // the CLI only buys a 404 and a retry before the same fallback answers.
        const turnCfg = { ...cfg, model: prep.model };

        const useGateway =
          cfg.transport === "gateway" ||
          (cfg.transport === "auto" && (await isGatewayReachable(cfg.gatewayPort)));

        const result = useGateway
          ? await askViaGateway(turnCfg, target, question, thinking, sessionId, evidence)
          : await askViaExec(turnCfg, target, question, thinking, evidence);

        result.impact = evidence;
        result.impactMs = impactMs;
        result.impactDisabled = !useImpact;
        result.impactUsed = Boolean(evidence);
        result.configuredModel = cfg.model;
        result.modelMismatch = modelMismatch(cfg.model, result.model);
        if (result.rateLimited) {
          return json(res, 429, {
            ...result,
            ok: false,
            error: `Cerebras rate limited this turn on tokens per minute, so no answer was produced.`,
            hint: `The public tier allows 30,000 tokens/minute, and Cerebras counts the requested output against it too. Wait ${result.retryAfter ?? 60}s and ask again, or turn the paired run off to spend one turn instead of two.`,
          });
        }
        return json(res, result.ok ? 200 : 502, result);
      }

      // Streaming ask. The CLI only prints the finished envelope, so this route
      // goes through the ACP bridge, which emits text as the model writes it.
      // The first token time here is real: it is the first chunk the browser got.
      if (req.method === "POST" && url.pathname === "/api/ask/stream") {
        const body = await readBody(req);
        const prep = await prepareAsk(cfg, body);
        if (prep.error) return json(res, prep.error, prep.body);

        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        const send = (event, data) => {
          if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        const started = performance.now();
        let ttftMs = null;
        let text = "";
        const prompt = prep.evidence
          ? `Repository: ${prep.target}\n\n${prep.question}\n\n<computed_impact>\n${impactPrompt(prep.evidence)}\n</computed_impact>`
          : `Repository: ${prep.target}\n\n${unaidedPrompt(prep.question)}`;

        const model = prep.model;
        send("meta", {
          impact: prep.evidence,
          impactMs: prep.impactMs,
          impactUsed: Boolean(prep.evidence),
          impactDisabled: !prep.useImpact,
          model,
          configuredModel: cfg.model,
          modelMismatch: model !== cfg.model,
          thinking: prep.thinking,
        });

        try {
          const out = await acp.ask({
            prompt,
            cwd: prep.target,
            thinking: prep.thinking,
            // The streamed turn obeys the same deadline as the JSON route, so a
            // stuck turn cannot outlive the one the UI promises to stop.
            timeoutMs: ASK_DEADLINE_MS,
            onChunk: (chunk) => {
              if (ttftMs === null) ttftMs = Math.round(performance.now() - started);
              text += chunk;
              send("delta", { text: chunk, t: Math.round(performance.now() - started) });
            },
          });
          send("done", {
            ok: true,
            final: text,
            ttftMs,
            elapsedMs: Math.round(performance.now() - started),
            agentMs: out.elapsedMs,
            assistantTurns: null,
            toolSummary: out.toolCalls ? { calls: out.toolCalls } : null,
            sessionId: out.sessionId,
            stopReason: out.stopReason,
            model,
            configuredModel: cfg.model,
            modelMismatch: model !== cfg.model,
            transport: "acp",
            impact: prep.evidence,
            impactMs: prep.impactMs,
            impactUsed: Boolean(prep.evidence),
            impactDisabled: !prep.useImpact,
          });
        } catch (e) {
          send("failed", {
            ok: false,
            error: `Streaming turn failed: ${e.message}`,
            hint: "The page falls back to /api/ask automatically. Run ./check-cerebras.sh if it keeps failing.",
          });
        }
        return res.end();
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

  // The bridge is spawned on demand; expose it so the entry point can warm it.
  server.acp = acp;
  server.syncModel = () => syncAgentModel(getConfig());
  server.on("close", () => acp.close());
  return server;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cfg = getConfig();
  const server = createAppServer();
  // Reconcile the agent model in the background: a wrong chain costs latency on
  // every question, but the server must not wait on the CLI to start.
  server.syncModel().then((s) => console.log("agent model:", JSON.stringify(s))).catch(() => {});
  server.listen(cfg.port, () => {
    console.log(`Sightread on http://localhost:${cfg.port}`);
    console.log(`model: ${cfg.model} (transport: ${cfg.transport})`);
    if (!process.env.CEREBRAS_API_KEY) {
      console.warn("warning: CEREBRAS_API_KEY is not set — agent turns will fail");
    }
  });
}
