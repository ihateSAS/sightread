import test from "node:test";
import assert from "node:assert/strict";
import { providerChain, reasoningEffortFor, streamProvider } from "../app/lib/provider.mjs";
import { contentStream, sse, startFakeProvider } from "./fake-provider.mjs";

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

test("qwen runs with reasoning off and kimi at low effort, others keep the default", async (t) => {
  const provider = await startFakeProvider(({ body }) =>
    body.model === "kimi-k3.1-pro"
      ? { status: 404, body: {} }
      : { stream: contentStream("ok") }
  );
  t.after(() => provider.close());
  useProviderEnv(t, provider.url);

  await streamProvider({ model: "cerebras/kimi-k3.1-pro", thinking: "low", prompt: "hi" });

  const [kimi, qwen] = provider.requests;
  // Kimi rejects "none" with a 400, so "low" is the floor that still works.
  assert.equal(kimi.body.reasoning_effort, "low");
  assert.equal(qwen.body.reasoning_effort, "none");
});

test("the page's thinking level reaches Kimi, clamped to values the endpoint accepts", async (t) => {
  const provider = await startFakeProvider(() => ({ stream: contentStream("ok") }));
  t.after(() => provider.close());
  useProviderEnv(t, provider.url);

  const ask = (thinking) =>
    streamProvider({ model: "cerebras/moonshotai-kimi-k3.1-pro-trial", thinking, prompt: "hi" });

  await ask("high");
  assert.equal(provider.requests.at(-1).body.reasoning_effort, "high");
  await ask("medium");
  assert.equal(provider.requests.at(-1).body.reasoning_effort, "medium");
  // Anything the endpoint cannot express becomes its fastest accepted value.
  for (const value of ["none", "off", "", undefined]) {
    await ask(value);
    assert.equal(provider.requests.at(-1).body.reasoning_effort, "low", `clamped ${value}`);
  }

  // A model with no thinking control never gets the field at all.
  await streamProvider({ model: "cerebras/gpt-oss-120b", thinking: "high", prompt: "hi" });
  assert.equal("reasoning_effort" in provider.requests.at(-1).body, false);
});

test("reasoningEffortFor never sends none to Kimi", () => {
  assert.equal(reasoningEffortFor("moonshotai-kimi-k3.1-pro-trial", "none"), "low");
  assert.equal(reasoningEffortFor("moonshotai-kimi-k3.1-pro-trial", "max"), "max");
  assert.equal(reasoningEffortFor("qwen-3.8-27b", "high"), "none");
  assert.equal(reasoningEffortFor("gpt-oss-120b", "high"), null);
});

test("thinking is timed and counted separately from the answer", async (t) => {
  const provider = await startFakeProvider(() => ({
    stream: [
      sse({ choices: [{ delta: { reasoning: "weighing the imports" } }] }),
      sse({ choices: [{ delta: { reasoning: " and the callers" } }] }),
      sse({ choices: [{ delta: { content: "lib/express.js:23 imports it." } }] }),
      sse({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 40,
          completion_tokens: 60,
          completion_tokens_details: { reasoning_tokens: 48 },
        },
      }),
      "data: [DONE]\n\n",
    ],
  }));
  t.after(() => provider.close());
  useProviderEnv(t, provider.url);

  const chunks = [];
  const out = await streamProvider({
    model: "cerebras/moonshotai-kimi-k3.1-pro-trial",
    thinking: "low",
    prompt: "hi",
    onChunk: (chunk) => chunks.push(chunk),
  });

  // Thinking is not the answer: the reasoning deltas never reach the page body.
  assert.deepEqual(chunks, ["lib/express.js:23 imports it."]);
  assert.equal(out.text, "lib/express.js:23 imports it.");
  assert.equal(out.phases.reasoningEffort, "low");
  assert.equal(out.phases.reasoningTokens, 48);
  assert.deepEqual(out.phases.usage, { input: 40, output: 60, reasoning: 48 });
  assert.ok(out.phases.promptToFirstDeltaMs <= out.phases.promptToFirstChunkMs);
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

test("a queued primary is abandoned for the next model instead of waited on", async (t) => {
  const provider = await startFakeProvider(async ({ body }) => {
    if (body.model === "kimi-k3.1-pro") {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      return { stream: contentStream("queued too long") };
    }
    return { stream: contentStream("answered instead") };
  });
  t.after(() => provider.close());
  useProviderEnv(t, provider.url);
  // Pin the budget so the test does not depend on the shipped default.
  const prevBudget = process.env.SIGHTREAD_FIRST_TOKEN_BUDGET_MS;
  process.env.SIGHTREAD_FIRST_TOKEN_BUDGET_MS = "300";
  t.after(() => {
    if (prevBudget === undefined) delete process.env.SIGHTREAD_FIRST_TOKEN_BUDGET_MS;
    else process.env.SIGHTREAD_FIRST_TOKEN_BUDGET_MS = prevBudget;
  });

  const started = Date.now();
  const out = await streamProvider({
    model: "cerebras/kimi-k3.1-pro",
    prompt: "hi",
    timeoutMs: 10_000,
  }).finally(() => {});
  assert.equal(out.text, "answered instead");
  assert.equal(out.model, "qwen-3.8-27b");
  assert.ok(Date.now() - started < 4_000, "did not wait out the queue");
  // The reported first token is measured from the turn, so the abandoned budget
  // still shows up instead of the fallback's own fast start.
  assert.ok(out.phases.promptToFirstChunkMs >= 300, "first token is turn-relative");
});
