// Is the shared trial endpoint congested right now?
//
//   node kimi-queue.mjs
//
// The Kimi trial model is shared by every team at the event, so first token
// swings from under a second to over ten with no code change. That difference is
// almost entirely queue time, not the model: compute stays near 300 tok/s while
// the queue moves by orders of magnitude. Recording during a spike makes the
// product look slow for a reason that has nothing to do with it.
//
// Prints one line every 90 seconds. Record when `queue` is small, which is
// usually a few hundred milliseconds. Free tier allows 5 requests a minute, so
// the interval leaves plenty of headroom.
//
// TPS here divides completion tokens by the provider's own completion_time, not
// wall clock, so queue time cannot flatter or spoil it.

import fs from "node:fs";

const key = (fs.readFileSync(new URL(".env", import.meta.url), "utf8").match(/^CEREBRAS_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!key) {
  console.error("CEREBRAS_API_KEY is not set in .env");
  process.exit(1);
}

const MODEL = process.env.SIGHTREAD_MODEL?.replace(/^cerebras\//, "") || "moonshotai-kimi-k3.1-pro-trial";
const URL_ = `${(process.env.CEREBRAS_BASE_URL || "https://api.cerebras.ai/v1").replace(/\/$/, "")}/chat/completions`;
const prompt = "Write a short paragraph about import graphs in JavaScript projects.";

async function pulse() {
  const started = Date.now();
  try {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 400,
        reasoning_effort: "low",
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      console.log(new Date().toISOString(), "HTTP", res.status, body.message || "");
      return;
    }
    const t = body.time_info || {};
    const usage = body.usage || {};
    const rate = Math.round((usage.completion_tokens || 0) / (t.completion_time || 1));
    console.log(
      new Date().toISOString(),
      `queue ${Math.round((t.queue_time || 0) * 1000)}ms`,
      `compute ${Math.round((t.completion_time || 0) * 1000)}ms`,
      `rate ${rate} tok/s`,
      `out ${usage.completion_tokens ?? "?"}`,
      `wall ${Date.now() - started}ms`
    );
  } catch (e) {
    console.log(new Date().toISOString(), "ERR", e.message);
  }
}

pulse();
setInterval(pulse, 90_000);
