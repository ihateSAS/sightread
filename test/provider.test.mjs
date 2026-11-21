import test from "node:test";
import assert from "node:assert/strict";
import { providerChain, streamProvider } from "../app/lib/provider.mjs";
import { contentStream, startFakeProvider } from "./fake-provider.mjs";

// Every test points the provider at a local stub. No real key, no network.
function useProviderEnv(t, url) {
  const prev = {
    key: process.env.CEREBRAS_API_KEY,
    base: process.env.CEREBRAS_BASE_URL,
  };
  process.env.CEREBRAS_API_KEY = "csk-test-123";
  process.env.CEREBRAS_BASE_URL = url;
  t.after(() => {
    if (prev.key === undefined) delete process.env.CEREBRAS_API_KEY;
    else process.env.CEREBRAS_API_KEY = prev.key;
    if (prev.base === undefined) delete process.env.CEREBRAS_BASE_URL;
    else process.env.CEREBRAS_BASE_URL = prev.base;
  });
}

test("the chain keeps its order and drops duplicates", () => {
  assert.deepEqual(providerChain("cerebras/kimi-k3.1-pro"), [
    "kimi-k3.1-pro",
    "qwen-3.8-27b",
    "gpt-oss-120b",
  ]);
  assert.deepEqual(providerChain("cerebras/qwen-3.8-27b"), ["qwen-3.8-27b", "gpt-oss-120b"]);
  assert.deepEqual(providerChain(null), ["qwen-3.8-27b", "gpt-oss-120b"]);
});

test("a missing first model falls through and the winner is named", async (t) => {
  const provider = await startFakeProvider(({ body }) =>
    body.model === "kimi-k3.1-pro"
      ? { status: 404, body: { error: { message: "model_not_found" } } }
      : { stream: contentStream("The graph names lib/express.js.") }
  );
  t.after(() => provider.close());
  useProviderEnv(t, provider.url);

  const chunks = [];
  const out = await streamProvider({
    model: "cerebras/kimi-k3.1-pro",
    thinking: "low",
    prompt: "hello",
    onChunk: (chunk) => chunks.push(chunk),
  });

  assert.equal(out.model, "qwen-3.8-27b");
  assert.equal(out.text, "The graph names lib/express.js.");
  assert.equal(chunks.join(""), out.text);
  assert.equal(out.stopReason, "stop");
  assert.deepEqual(out.phases.usage, { input: 11, output: 5 });
  assert.equal(typeof out.phases.headersMs, "number");
  assert.equal(typeof out.phases.promptToFirstChunkMs, "number");
  assert.ok(out.phases.totalMs >= 0);

  assert.deepEqual(
    provider.requests.map((r) => r.body.model),
    ["kimi-k3.1-pro", "qwen-3.8-27b"]
  );
});

test("qwen runs with reasoning off, the other models keep the provider default", async (t) => {
  const provider = await startFakeProvider(({ body }) =>
    body.model === "kimi-k3.1-pro"
      ? { status: 404, body: {} }
      : { stream: contentStream("ok") }
  );
  t.after(() => provider.close());
  useProviderEnv(t, provider.url);

  await streamProvider({ model: "cerebras/kimi-k3.1-pro", thinking: "low", prompt: "hi" });

  const [kimi, qwen] = provider.requests;
  assert.equal(kimi.body.reasoning_effort, undefined);
  assert.equal(qwen.body.reasoning_effort, "none");
});

test("a model that streams no text is skipped, not returned empty", async (t) => {
  const provider = await startFakeProvider(({ body }) =>
    body.model === "kimi-k3.1-pro"
      ? {
          stream: [
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":0}}\n\n',
            "data: [DONE]\n\n",
          ],
        }
      : { stream: contentStream("answered by the fallback") }
  );
  t.after(() => provider.close());
  useProviderEnv(t, provider.url);

  const out = await streamProvider({ model: "cerebras/kimi-k3.1-pro", prompt: "hi" });
  assert.equal(out.model, "qwen-3.8-27b");
  assert.equal(out.text, "answered by the fallback");
});

test("every model failing rejects with the provider's error, not an empty answer", async (t) => {
  const provider = await startFakeProvider(() => ({
    status: 500,
    body: { error: { message: "upstream exploded" } },
  }));
  t.after(() => provider.close());
  useProviderEnv(t, provider.url);

  await assert.rejects(
    () => streamProvider({ model: "cerebras/kimi-k3.1-pro", prompt: "hi" }),
    /HTTP 500/
  );
  assert.equal(provider.requests.length, 3, "tried the whole declared chain");
});

test("a bad key stops at the first attempt instead of cycling the chain", async (t) => {
  const provider = await startFakeProvider(() => ({ status: 401, body: {} }));
  t.after(() => provider.close());
  useProviderEnv(t, provider.url);

  await assert.rejects(
    () => streamProvider({ model: "cerebras/kimi-k3.1-pro", prompt: "hi" }),
    /HTTP 401/
  );
  assert.equal(provider.requests.length, 1);
});

test("a stalled provider aborts instead of hanging the turn", async (t) => {
  const provider = await startFakeProvider(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    return { stream: contentStream("too late") };
  });
  t.after(() => provider.close());
  useProviderEnv(t, provider.url);

  const started = Date.now();
  await assert.rejects(
    () => streamProvider({ model: "cerebras/qwen-3.8-27b", prompt: "hi", timeoutMs: 150 }),
    /timeout|abort/i
  );
  assert.ok(Date.now() - started < 3_000, "did not wait for the stall to finish");
});
