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

// Kimi's thinking is on by default and its lowest accepted effort is "low" —
// "none" is rejected with HTTP 400. So the level the page chooses is forwarded
// as-is when the endpoint can express it, and anything it cannot (a missing
// value, "off", "none") is clamped to "low" rather than sent and 400'd.
const KIMI_EFFORTS = new Set(["low", "medium", "high", "max"]);

export function reasoningEffortFor(candidate, thinking) {
  // qwen spends its whole budget on hidden reasoning and can stream no text at
  // all, so it always answers with thinking off.
  if (/qwen/i.test(candidate)) return "none";
  if (!/kimi/i.test(candidate)) return null;
  const level = String(thinking || "").trim().toLowerCase();
  return KIMI_EFFORTS.has(level) ? level : "low";
}

export async function streamProvider({ model, thinking, prompt, onChunk, timeoutMs = 45_000 }) {
  const key = process.env.CEREBRAS_API_KEY;
  if (!key) throw new Error("CEREBRAS_API_KEY is not set");

  const started = performance.now();
  let lastError = "";

  // A queue is not a failure, but it is a delay the product promised not to pay:
  // every change question is answered twice, so a shared endpoint stalling for
  // 30s costs the whole feature. When the world is congested, whoever answers
  // first wins the turn instead of whoever was configured first. It only applies
  // before the first content chunk, so an answer that has started is never cut
  // off mid-sentence, and never to the last candidate because there is nothing
  // left to fall through to.
  const budgetMs = Math.max(0, Number(process.env.SIGHTREAD_FIRST_TOKEN_BUDGET_MS ?? 3000) || 0);
  const chain = providerChain(model);

  for (const [index, candidate] of chain.entries()) {
    const attemptAt = performance.now();
    const effort = reasoningEffortFor(candidate, thinking);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(new Error("turn timeout")), timeoutMs);
    let budgetHit = false;
    let budgetTimer =
      budgetMs > 0 && index < chain.length - 1
        ? setTimeout(() => {
            budgetHit = true;
            controller.abort(new Error("first token budget"));
          }, budgetMs)
        : null;
    let res;
    try {
      res = await fetch(url(), {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: candidate,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 4096,
          stream: true,
          stream_options: { include_usage: true },
          ...(effort ? { reasoning_effort: effort } : {}),
        }),
      });
    } catch (e) {
      clearTimeout(deadline);
      if (budgetTimer) clearTimeout(budgetTimer);
      lastError = `${candidate}: ${e.message}`;
      continue;
    }

    if (!res.ok || !res.body) {
      clearTimeout(deadline);
      if (budgetTimer) clearTimeout(budgetTimer);
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
    let firstDeltaAt = null;
    let firstChunkAt = null;
    let reasoningChars = 0;
    let reasoningTokens = null;
    let stopReason = null;
    let usage = null;

    try {
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
          const delta = obj.choices?.[0]?.delta;
          // Kimi streams reasoning before it writes the answer. That is thinking
          // happening, so it is timed separately from the first content chunk the
          // page shows; only content counts as the turn's first token.
          const thought = delta?.reasoning;
          if (thought) {
            if (firstDeltaAt === null) firstDeltaAt = performance.now();
            reasoningChars += thought.length;
          }
          const chunk = delta?.content;
          if (chunk) {
            if (firstDeltaAt === null) firstDeltaAt = performance.now();
            if (firstChunkAt === null) {
              firstChunkAt = performance.now();
              // The answer has started, so the queue budget no longer applies.
              if (budgetTimer) {
                clearTimeout(budgetTimer);
                budgetTimer = null;
              }
            }
            text += chunk;
            onChunk?.(chunk);
          }
          const finish = obj.choices?.[0]?.finish_reason;
          if (finish) stopReason = finish;
          if (obj.usage) {
            usage = obj.usage;
            const rt = obj.usage.completion_tokens_details?.reasoning_tokens;
            if (typeof rt === "number") reasoningTokens = rt;
          }
        }
      }
    } catch (e) {
      // An aborted read is only worth reporting when nothing has been written
      // yet; once content is on screen the partial answer is the answer.
      if (!text) {
        lastError = budgetHit
          ? `${candidate}: queued, no first token inside ${budgetMs}ms`
          : `${candidate}: ${e.message}`;
        reader.cancel().catch(() => {});
        clearTimeout(deadline);
        if (budgetTimer) clearTimeout(budgetTimer);
        continue;
      }
    } finally {
      clearTimeout(deadline);
      if (budgetTimer) clearTimeout(budgetTimer);
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
        reasoningEffort: effort,
        // Reasoning tokens are billed as output, so a turn that thinks more is
        // visible rather than inferred from a slower clock.
        reasoningTokens:
          typeof reasoningTokens === "number"
            ? reasoningTokens
            : reasoningChars > 0
              ? null
              : 0,
        // Measured from the turn, not from this attempt: when a queued candidate
        // is abandoned the caller still waited the budget, and a per-attempt number
        // would report the fallback's 0.3s for a turn that took 8s on screen.
        promptToFirstDeltaMs:
          firstDeltaAt === null ? null : Math.round(firstDeltaAt - started),
        promptToFirstChunkMs: firstChunkAt === null ? null : Math.round(firstChunkAt - started),
        streamMs: firstChunkAt === null ? null : Math.round(endedAt - firstChunkAt),
        totalMs: Math.round(endedAt - started),
        usage: usage
          ? {
              input: usage.prompt_tokens ?? null,
              output: usage.completion_tokens ?? null,
              ...(typeof reasoningTokens === "number" ? { reasoning: reasoningTokens } : {}),
            }
          : null,
      },
    };
  }

  throw new Error(lastError || "no model answered");
}
