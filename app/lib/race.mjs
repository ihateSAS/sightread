const ALLOWED_EFFORTS = new Set(["low", "medium", "high", "max"]);

export function getSides() {
  return {
    cerebras: {
      label: "Cerebras",
      url: (process.env.CEREBRAS_BASE_URL || "https://api.cerebras.ai/v1").replace(/\/$/, "") + "/chat/completions",
      key: () => process.env.CEREBRAS_API_KEY,
      model: () => process.env.CEREBRAS_RACE_MODEL || "gpt-oss-120b",
      envName: "CEREBRAS_API_KEY",
    },
    openrouter: {
      label: "OpenRouter",
      url: (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "") + "/chat/completions",
      key: () => process.env.OPENROUTER_API_KEY,
      model: () => process.env.OPENROUTER_RACE_MODEL || "moonshotai/kimi-k2",
      envName: "OPENROUTER_API_KEY",
    },
  };
}

// Providers prefix the same weights differently (gpt-oss-120b vs
// openai/gpt-oss-120b), so compare the model name without its namespace. Cerebras
// also serves the event build under a `-trial` suffix, which is the same weights
// as the hosted id, so the suffix is not a difference either.
const baseModel = (id) =>
  String(id || "")
    .split("/")
    .pop()
    .toLowerCase()
    .replace(/^moonshotai-/, "")
    .replace(/[-_](trial|test)$/, "")
    .replace(/[^a-z0-9.]/g, "");

export function getRaceState() {
  const SIDES = getSides();
  const cerebras = SIDES.cerebras.model();
  const openrouter = SIDES.openrouter.model();
  return {
    cerebras: { model: cerebras, ready: Boolean(SIDES.cerebras.key()) },
    openrouter: { model: openrouter, ready: Boolean(SIDES.openrouter.key()) },
    sameModel: baseModel(cerebras) === baseModel(openrouter),
  };
}

async function runSide(side, cfg, prompt, maxTokens, reasoningEffort, t0, send, signal) {
  const key = cfg.key();
  const model = cfg.model();

  if (!key) {
    send({ side, event: "skip", reason: `${cfg.envName} is not set`, model });
    return;
  }

  send({ side, event: "start", model, t: 0 });

  const payloadBody = {
    model,
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };
  // Qwen will happily spend a short answer's whole budget on hidden reasoning
  // and then return no text at all, on either provider. The race measures
  // generation, so thinking is turned off explicitly for that model.
  if (/qwen/i.test(model)) {
    if (side === "cerebras") payloadBody.reasoning_effort = "none";
    else payloadBody.reasoning = { enabled: false };
  } else if (ALLOWED_EFFORTS.has(reasoningEffort)) {
    // Without this, OpenRouter runs at its provider default and can burn the
    // whole budget thinking. Cerebras takes the flat field, OpenRouter the object.
    if (side === "cerebras") payloadBody.reasoning_effort = reasoningEffort;
    else payloadBody.reasoning = { effort: reasoningEffort === "max" ? "high" : reasoningEffort };
  }

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
      body: JSON.stringify(payloadBody),
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
  let reasoningChars = 0;
  let chunks = 0;
  let tokens = null;
  let firstTokenMs = null;
  let completionTimeSec = null;

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
      try {
        obj = JSON.parse(payload);
      } catch {
        continue;
      }

      if (obj.usage && typeof obj.usage.completion_tokens === "number") {
        tokens = obj.usage.completion_tokens;
      }
      if (obj.time_info && typeof obj.time_info.completion_time === "number") {
        completionTimeSec = obj.time_info.completion_time;
      }
      const delta = obj.choices?.[0]?.delta;
      // Reasoning is not the answer: track it so a budget spent entirely on
      // thinking becomes a visible error instead of an empty pane.
      reasoningChars += (delta?.reasoning || "").length + (delta?.reasoning_content || "").length;
      const text = delta?.content;
      if (text) {
        if (firstTokenMs === null) firstTokenMs = now();
        chars += text.length;
        chunks += 1;
        send({ side, event: "delta", t: now(), text });
      }
    }
  }

  const totalMs = now();
  if (chars === 0) {
    send({
      side,
      event: "error",
      model,
      reason: reasoningChars
        ? `No answer text: the model spent the whole budget reasoning (${reasoningChars.toLocaleString()} chars). Lower the effort or raise the token cap.`
        : `No answer text arrived (${tokens ?? 0} tokens). The provider may have refused this prompt.`,
    });
    return;
  }
  send({
    side,
    event: "done",
    model,
    totalMs,
    firstTokenMs,
    tokens,
    chunks,
    chars,
    reasoningChars,
    exact: tokens !== null,
    tps: tokens && totalMs > 0 ? +(tokens / (totalMs / 1000)).toFixed(1) : null,
    serverTps: tokens && completionTimeSec > 0 ? +(tokens / completionTimeSec).toFixed(1) : null,
  });
}

export async function runRaceStream(req, res, body) {
  const prompt = String(body?.prompt || "").slice(0, 8000);
  const maxTokens = Math.min(Math.max(Number(body?.maxTokens) || 600, 16), 8000);
  const reasoningEffort = ALLOWED_EFFORTS.has(body?.reasoningEffort) ? body.reasoningEffort : "low";
  if (!prompt.trim()) {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "prompt required" }));
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  const t0 = performance.now();
  const send = (obj) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  const SIDES = getSides();
  await Promise.all(
    Object.entries(SIDES).map(([side, cfg]) =>
      runSide(side, cfg, prompt, maxTokens, reasoningEffort, t0, send, controller.signal).catch((e) =>
        send({ side, event: "error", reason: String(e.message || e) })
      )
    )
  );

  send({ event: "end" });
  return res.end();
}
