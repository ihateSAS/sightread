import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.RACE_PORT) || 8788;

const SIDES = {
  cerebras: {
    label: "Cerebras",
    url: "https://api.cerebras.ai/v1/chat/completions",
    key: () => process.env.CEREBRAS_API_KEY,
    model: () => process.env.CEREBRAS_RACE_MODEL || "gpt-oss-120b",
    envName: "CEREBRAS_API_KEY",
  },
  openrouter: {
    label: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: () => process.env.OPENROUTER_API_KEY,
    model: () => process.env.OPENROUTER_RACE_MODEL || "moonshotai/kimi-k2",
    envName: "OPENROUTER_API_KEY",
  },
};

// Streams one provider and reports every event with a time relative to t0,
// so both panes are measured on the same clock.
async function runSide(side, prompt, maxTokens, t0, send, signal) {
  const cfg = SIDES[side];
  const key = cfg.key();
  const model = cfg.model();

  if (!key) {
    send({ side, event: "skip", reason: `${cfg.envName} is not set`, model });
    return;
  }

  send({ side, event: "start", model, t: 0 });

  let res;
  try {
    res = await fetch(cfg.url, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        ...(side === "openrouter"
          ? { "http-referer": "http://localhost", "x-title": "Sightread race" }
          : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
  } catch (e) {
    send({ side, event: "error", reason: String(e.message || e), model });
    return;
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    send({ side, event: "error", reason: `HTTP ${res.status}: ${text.slice(0, 300)}`, model });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let chars = 0;
  let chunks = 0;
  let tokens = null;
  let firstTokenMs = null;

  const now = () => Math.round(performance.now() - t0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let obj;
      try { obj = JSON.parse(payload); } catch { continue; }

      if (obj.usage && typeof obj.usage.completion_tokens === "number") {
        tokens = obj.usage.completion_tokens;
      }
      const text = obj.choices?.[0]?.delta?.content;
      if (text) {
        if (firstTokenMs === null) firstTokenMs = now();
        chars += text.length;
        chunks += 1;
        send({ side, event: "delta", t: now(), text });
      }
    }
  }

  const totalMs = now();
  send({
    side,
    event: "done",
    model,
    totalMs,
    firstTokenMs,
    tokens,
    chunks,
    chars,
    // Exact when the provider reports usage; otherwise chunks is a labelled estimate.
    exact: tokens !== null,
    tps: tokens ? +(tokens / (totalMs / 1000)).toFixed(1) : null,
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { reject(new Error("invalid JSON")); }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const html = await readFile(join(HERE, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    return res.end(JSON.stringify({
      cerebras: { model: SIDES.cerebras.model(), ready: Boolean(SIDES.cerebras.key()) },
      openrouter: { model: SIDES.openrouter.model(), ready: Boolean(SIDES.openrouter.key()) },
    }));
  }

  if (req.method === "POST" && url.pathname === "/api/race") {
    let body;
    try { body = await readBody(req); } catch (e) { res.writeHead(400); return res.end(e.message); }

    const prompt = String(body.prompt || "").slice(0, 8000);
    const maxTokens = Math.min(Math.max(Number(body.maxTokens) || 600, 16), 8000);
    if (!prompt) { res.writeHead(400); return res.end("prompt required"); }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    const controller = new AbortController();
    req.on("close", () => controller.abort());

    const t0 = performance.now();
    const send = (obj) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    await Promise.all(
      Object.keys(SIDES).map((side) =>
        runSide(side, prompt, maxTokens, t0, send, controller.signal).catch((e) =>
          send({ side, event: "error", reason: String(e.message || e) })
        )
      )
    );

    send({ event: "end" });
    return res.end();
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`race page: http://localhost:${PORT}`);
  console.log(`  cerebras   ${SIDES.cerebras.model()}  ${SIDES.cerebras.key() ? "ready" : "NO KEY"}`);
  console.log(`  openrouter ${SIDES.openrouter.model()}  ${SIDES.openrouter.key() ? "ready" : "NO KEY (right pane will show as stub)"}`);
});
