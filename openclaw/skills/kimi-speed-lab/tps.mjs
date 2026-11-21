#!/usr/bin/env node
// Dependency-free TPS measurement for Cerebras (and any OpenAI-compatible endpoint).
//
//   node tps.mjs --model kimi-k3.1-pro --reasoning low --max-tokens 2000
//   node tps.mjs --model gpt-oss-120b --runs 3 --prompt "count to 500"
//
// Env: CEREBRAS_API_KEY (required), CEREBRAS_BASE_URL (optional override).

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const baseUrl = (process.env.CEREBRAS_BASE_URL || "https://api.cerebras.ai/v1").replace(/\/$/, "");
const model = opt("model", "kimi-k3.1-pro");
const reasoning = opt("reasoning", "low");
const maxTokens = Number(opt("max-tokens", 2000));
const runs = Number(opt("runs", 1));
const prompt = opt(
  "prompt",
  "Write the integers from 1 to 2000, each on its own line, with no other text."
);
const key = process.env.CEREBRAS_API_KEY;

if (!key) {
  console.error("CEREBRAS_API_KEY is not set.");
  process.exit(1);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const one = async () => {
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: maxTokens,
    stream: false,
  };
  // "none" is not supported by K3.1 Pro; omit the field rather than sending it.
  if (reasoning && reasoning !== "none") body.reasoning_effort = reasoning;

  const t0 = performance.now();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const elapsed = (performance.now() - t0) / 1000;

  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 600)}`);
    process.exit(1);
  }

  const json = await res.json();
  const usage = json.usage || {};
  const t = json.time_info || {};
  const completion = usage.completion_tokens ?? 0;
  const serverSecs = t.completion_time ?? elapsed;
  const serverTps = serverSecs > 0 ? completion / serverSecs : 0;

  if (completion === 0) {
    console.error("No completion tokens returned — check the model id with:");
    console.error(`  curl -s ${baseUrl}/models -H "Authorization: Bearer $CEREBRAS_API_KEY"`);
    process.exit(1);
  }

  return {
    serverTps,
    wallTps: completion / elapsed,
    promptTokens: usage.prompt_tokens ?? 0,
    completion,
    elapsed,
    timeInfo: t,
  };
};

const results = [];
for (let i = 0; i < runs; i++) {
  const r = await one();
  results.push(r);
  process.stderr.write(`run ${i + 1}/${runs}: ${r.serverTps.toFixed(0)} tok/s (server)\n`);
}

const server = median(results.map((r) => r.serverTps));
const wall = median(results.map((r) => r.wallTps));
const spread = results.length > 1
  ? `${Math.min(...results.map((r) => r.serverTps)).toFixed(0)}-${Math.max(...results.map((r) => r.serverTps)).toFixed(0)}`
  : "n/a (1 run)";
const last = results[results.length - 1];

console.log("");
console.log(`model     ${model}`);
console.log(`effort    ${reasoning}`);
console.log(`max_tokens ${maxTokens}`);
console.log(`runs      ${runs}`);
console.log(`prompt    ${last.promptTokens} tokens in`);
console.log(`output    ${last.completion} tokens`);
console.log("");
console.log(`server    ${server.toFixed(0)} tok/s   (median${runs > 1 ? `, spread ${spread}` : ""})`);
console.log(`wall      ${wall.toFixed(0)} tok/s   (includes network + queueing)`);
console.log(`elapsed   ${results.map((r) => r.elapsed.toFixed(2)).join("s, ")}s`);
console.log("");
console.log("time_info", JSON.stringify(last.timeInfo));
