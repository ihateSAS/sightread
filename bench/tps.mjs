// Decode speed, the way the official speed patch reads it.
//
//   node bench/tps.mjs                      every model, 3 calls each
//   node bench/tps.mjs gpt-oss-120b 5       one model, 5 calls
//
// TPS here is `usage.completion_tokens / time_info.completion_time`, both of
// which Cerebras puts in the last stream chunk. That is the same ratio the
// bounty patch computes, and dividing by the server's own decode clock is the
// point: queue time, network and our own loop cannot flatter or spoil it.
//
// The other common number, first chunk to last chunk on the client, is lower on
// this endpoint because the server finishes before delivery catches up. Kimi
// reads about 200 tok/s that way and 270-350 this way.

import fs from "node:fs";

const key = (fs.readFileSync(new URL("../.env", import.meta.url), "utf8").match(/^CEREBRAS_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!key) {
  console.error("CEREBRAS_API_KEY is not set in .env");
  process.exit(1);
}

const BASE = (process.env.CEREBRAS_BASE_URL || "https://api.cerebras.ai/v1").replace(/\/$/, "");
const PROMPT = "Explain how a JavaScript bundler resolves imports, thoroughly.";

async function once(model, tokens) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: PROMPT }], max_tokens: tokens, stream: true, stream_options: { include_usage: true } }),
  });
  if (!res.ok) return { error: `HTTP ${res.status}` };

  const decoder = new TextDecoder();
  let buf = "";
  let last = null;
  for await (const part of res.body) {
    buf += decoder.decode(part, { stream: true });
    let cut;
    while ((cut = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, cut).trim();
      buf = buf.slice(cut + 1);
      if (line.startsWith("data:") && line.slice(5).trim() !== "[DONE]") last = line.slice(5).trim();
    }
  }
  if (!last) return { error: "no chunks" };

  const chunk = JSON.parse(last);
  const seconds = chunk.time_info?.completion_time;
  const out = chunk.usage?.completion_tokens;
  if (!seconds || !out) return { error: "no time_info in the last chunk" };
  return { out, seconds, queue: chunk.time_info.queue_time ?? 0, tps: out / seconds };
}

const wanted = process.argv[2];
const calls = Number(process.argv[3] || 3);
const tokens = Number(process.env.BENCH_TOKENS || 2000);

let models = [wanted];
if (!wanted) {
  const listing = await fetch(`${BASE}/models`, { headers: { authorization: `Bearer ${key}` } }).then((r) => r.json());
  models = (listing.data || []).map((m) => m.id);
}

for (const model of models) {
  const runs = [];
  for (let i = 0; i < calls; i++) {
    runs.push(await once(model, tokens));
    await new Promise((r) => setTimeout(r, 1500));
  }
  const ok = runs.filter((r) => !r.error);
  const line = ok.map((r) => `${r.tps.toFixed(0)}`).join(", ");
  const errors = runs.filter((r) => r.error).map((r) => r.error);
  if (!ok.length) {
    console.log(`${model.padEnd(34)} ${errors.join(", ")}`);
    continue;
  }
  const best = Math.max(...ok.map((r) => r.tps));
  const worst = Math.min(...ok.map((r) => r.tps));
  console.log(`${model.padEnd(34)} ${tokens} out  ${line} tok/s  (best ${best.toFixed(0)}, worst ${worst.toFixed(0)})${errors.length ? `  ${errors.length} refused: ${errors.join(", ")}` : ""}`);
}
