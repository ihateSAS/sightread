// Direct streaming from Cerebras.
//
// Measured on this machine against the same prompt: provider to first token
// ~2.3s, gateway agent turn ~22s, with the gateway log showing 14s of its own
// preparation and multi-second SQLite writes per turn. The answer needs no
// tools, no history and no workspace access, so the gateway adds cost without
// adding anything. The declared chain is still honoured: a model the provider
// no longer lists is skipped and the next one answers.

const url = () =>
  `${(process.env.CEREBRAS_BASE_URL || "https://api.cerebras.ai/v1").replace(/\/$/, "")}/chat/completions`;

const bare = (model) => String(model || "").replace(/^cerebras\//i, "");

export const providerChain = (model) =>
  [...new Set([model, "cerebras/qwen-3.8-27b", "cerebras/gpt-oss-120b"].map(bare).filter(Boolean))];

export async function streamProvider({ model, thinking, prompt, onChunk, timeoutMs = 45_000 }) {
  const key = process.env.CEREBRAS_API_KEY;
  if (!key) throw new Error("CEREBRAS_API_KEY is not set");

  const started = performance.now();
  let lastError = "";

  for (const candidate of providerChain(model)) {
    const attemptAt = performance.now();
    let res;
    try {
      res = await fetch(url(), {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: candidate,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 4096,
          stream: true,
          stream_options: { include_usage: true },
          // Qwen otherwise spends a short answer's budget on hidden reasoning.
          ...(/qwen/i.test(candidate) ? { reasoning_effort: "none" } : {}),
        }),
      });
    } catch (e) {
      lastError = `${candidate}: ${e.message}`;
      continue;
    }

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      lastError = `${candidate}: HTTP ${res.status} ${body.slice(0, 200)}`;
      // A wrong key fails identically for every model, so stop there.
      if (res.status === 401 || res.status === 403) break;
      continue;
    }

    const headersMs = Math.round(performance.now() - attemptAt);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let firstChunkAt = null;
    let stopReason = null;
    let usage = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let obj;
        try {
          obj = JSON.parse(data);
        } catch {
          continue;
        }
        const chunk = obj.choices?.[0]?.delta?.content;
        if (chunk) {
          if (firstChunkAt === null) firstChunkAt = performance.now();
          text += chunk;
          onChunk?.(chunk);
        }
        const finish = obj.choices?.[0]?.finish_reason;
        if (finish) stopReason = finish;
        if (obj.usage) usage = obj.usage;
      }
    }

    // A model that streamed nothing is a failed candidate, not an empty answer.
    if (!text) {
      lastError = `${candidate}: returned no content`;
      continue;
    }

    const endedAt = performance.now();
    return {
      model: candidate,
      text,
      stopReason,
      toolCalls: 0,
      sessionId: null,
      elapsedMs: Math.round(endedAt - attemptAt),
      phases: {
        headersMs,
        promptToFirstChunkMs: firstChunkAt === null ? null : Math.round(firstChunkAt - attemptAt),
        streamMs: firstChunkAt === null ? null : Math.round(endedAt - firstChunkAt),
        totalMs: Math.round(endedAt - started),
        usage: usage
          ? { input: usage.prompt_tokens ?? null, output: usage.completion_tokens ?? null }
          : null,
      },
    };
  }

  throw new Error(lastError || "no model answered");
}
