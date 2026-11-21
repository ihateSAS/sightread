import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "../app/lib/env.mjs";
import { normalizeRepoUrl, readCitedFile, slugFromUrl } from "../app/lib/repo.mjs";
import { createAppServer, modelMismatch } from "../app/server.mjs";
import { contentStream, startFakeProvider } from "./fake-provider.mjs";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("parseEnv handles quotes, exports, and inline comments", () => {
  const parsed = parseEnv(`
    # comment
    CEREBRAS_API_KEY="csk-test-123"
    export OPENROUTER_API_KEY='or-test-456'
    PORT=8787 # default port
    EMPTY=
  `);
  assert.equal(parsed.CEREBRAS_API_KEY, "csk-test-123");
  assert.equal(parsed.OPENROUTER_API_KEY, "or-test-456");
  assert.equal(parsed.PORT, "8787");
  assert.equal(parsed.EMPTY, "");
});

test("modelMismatch catches a silent fallback but ignores the provider prefix", () => {
  assert.equal(modelMismatch("cerebras/kimi-k3.1-pro", "cerebras/kimi-k3.1-pro"), false);
  assert.equal(modelMismatch("cerebras/kimi-k3.1-pro", "kimi-k3.1-pro"), false);
  assert.equal(modelMismatch("cerebras/kimi-k3.1-pro", "cerebras/gpt-oss-120b"), true);
  assert.equal(modelMismatch("cerebras/kimi-k3.1-pro", "moonshotai/kimi-k3.1-pro"), false);
  assert.equal(modelMismatch("cerebras/kimi-k3.1-pro", null), false);
});

test("normalizeRepoUrl and slugFromUrl accept URLs and owner/repo shorthand", () => {
  assert.equal(normalizeRepoUrl("vercel/next.js"), "https://github.com/vercel/next.js.git");
  assert.equal(normalizeRepoUrl("https://github.com/cerebras/demo"), "https://github.com/cerebras/demo");
  assert.equal(slugFromUrl("https://github.com/cerebras/demo.git"), "cerebras__demo");
  assert.equal(slugFromUrl("vercel/next.js"), "vercel__next.js");
  assert.throws(() => normalizeRepoUrl("--upload-pack=evil"), /invalid repository URL/);
  assert.throws(() => normalizeRepoUrl("file:///etc/passwd"), /repository reference/);
});

test("readCitedFile returns highlighted slice and blocks traversal", async () => {
  const res = await readCitedFile({
    repoInput: PROJECT_ROOT,
    filePath: "package.json",
    line: 2,
    endLine: 4,
    context: 2,
    projectRoot: PROJECT_ROOT,
    reposDir: join(PROJECT_ROOT, "repos"),
  });
  assert.equal(res.path, "package.json");
  assert.ok(res.lines.some((l) => l.number === 2 && l.highlighted));
  assert.ok(res.lines.some((l) => l.number === 4 && l.highlighted));

  await assert.rejects(
    () =>
      readCitedFile({
        repoInput: PROJECT_ROOT,
        filePath: "../../etc/passwd",
        line: 1,
        projectRoot: PROJECT_ROOT,
        reposDir: join(PROJECT_ROOT, "repos"),
      }),
    /not found inside repository/
  );
});

test("HTTP server serves UI, health, repos, file inspection, and validates inputs", async (t) => {
  const tmpRepos = mkdtempSync(join(tmpdir(), "sightread-repos-"));
  const demoRepo = join(tmpRepos, "acme__demo");
  mkdirSync(demoRepo, { recursive: true });
  writeFileSync(join(demoRepo, "index.js"), "line1\nline2\nline3\n");

  const server = createAppServer({ projectRoot: PROJECT_ROOT, reposDir: tmpRepos });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.close();
    rmSync(tmpRepos, { recursive: true, force: true });
  });

  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /Sightread/);
  assert.match(html, /Speed Race/);
  assert.match(html, /paired run/);
  assert.doesNotMatch(html, /function coverageOf/);

  const coverageModule = await fetch(`${base}/coverage.mjs`);
  assert.equal(coverageModule.status, 200);
  assert.match(coverageModule.headers.get("content-type"), /text\/javascript/);

  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  assert.equal(health.ok, true);
  assert.ok("effectiveTransport" in health);

  const repos = await fetch(`${base}/api/repos`).then((r) => r.json());
  assert.equal(repos.repos.length, 2);
  assert.equal(repos.repos[1].name, "acme/demo");

  const fileRes = await fetch(
    `${base}/api/file?repo=${encodeURIComponent(demoRepo)}&path=index.js&line=2`
  ).then((r) => r.json());
  assert.equal(fileRes.focusStart, 2);
  assert.equal(fileRes.lines.find((l) => l.number === 2)?.text, "line2");

  const badPrepare = await fetch(`${base}/api/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "--bad" }),
  });
  assert.equal(badPrepare.status, 400);

  const badAsk = await fetch(`${base}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo: demoRepo, question: "   " }),
  });
  assert.equal(badAsk.status, 400);

  const impact = await fetch(`${base}/api/impact?repo=${encodeURIComponent(demoRepo)}`).then((r) => r.json());
  assert.equal(impact.stats.files, 1);
  assert.equal(impact.stats.imports, 0);

  const raceState = await fetch(`${base}/api/race/state`);
  assert.equal(raceState.status, 200);
  const raceJson = await raceState.json();
  assert.ok("cerebras" in raceJson && "openrouter" in raceJson);
});

test("ask fails fast without a key and skips the CLI probe on the direct path", async (t) => {
  const prev = {
    key: process.env.CEREBRAS_API_KEY,
    model: process.env.SIGHTREAD_MODEL,
    base: process.env.CEREBRAS_BASE_URL,
  };
  process.env.SIGHTREAD_MODEL = "cerebras/kimi-k3.1-pro";
  // The key is present before the server starts, so its boot warm does not run.
  // That keeps the probe count unambiguous.
  process.env.CEREBRAS_API_KEY = "csk-test-not-real";
  process.env.CEREBRAS_BASE_URL = "http://127.0.0.1:1/v1";

  let probes = 0;
  const server = createAppServer({
    projectRoot: PROJECT_ROOT,
    reposDir: join(PROJECT_ROOT, "repos"),
    modelProbe: async () => {
      probes += 1;
      return { present: false };
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.close();
    for (const [key, value] of [
      ["CEREBRAS_API_KEY", prev.key],
      ["SIGHTREAD_MODEL", prev.model],
      ["CEREBRAS_BASE_URL", prev.base],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const askOnce = () =>
    fetch(`${base}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: PROJECT_ROOT, question: "what breaks if I change lib/impact.mjs?" }),
    });

  delete process.env.CEREBRAS_API_KEY;
  const noKey = await askOnce();
  assert.equal(noKey.status, 400);
  const noKeyBody = await noKey.json();
  assert.match(noKeyBody.error, /CEREBRAS_API_KEY/);
  assert.ok(noKeyBody.hint);
  assert.equal(noKeyBody.elapsedMs, undefined);
  assert.equal(probes, 0, "no model probe without a key");

  // With a key the turn goes straight to the provider, so an OpenClaw model
  // registration is irrelevant. The dead port makes the provider fail: the
  // answer must come from that failure, not a 25s CLI probe first.
  process.env.CEREBRAS_API_KEY = "csk-test-not-real";
  const direct = await askOnce();
  assert.equal(direct.status, 502);
  const directBody = await direct.json();
  assert.match(directBody.error, /provider failed/i);
  assert.equal(probes, 0, "the OpenClaw probe is not on the direct path");
});

test("a Kimi answer is not labelled a fallback, and the stream carries usage", async (t) => {
  const provider = await startFakeProvider(({ url }) =>
    url.endsWith("/models")
      ? { body: { data: [{ id: "kimi-k3.1-pro" }, { id: "qwen-3.8-27b" }] } }
      : { stream: contentStream("lib/express.js imports it at line 18.") }
  );
  t.after(() => provider.close());

  const prev = {
    key: process.env.CEREBRAS_API_KEY,
    model: process.env.SIGHTREAD_MODEL,
    base: process.env.CEREBRAS_BASE_URL,
  };
  process.env.CEREBRAS_API_KEY = "csk-test-123";
  process.env.SIGHTREAD_MODEL = "cerebras/kimi-k3.1-pro";
  process.env.CEREBRAS_BASE_URL = provider.url;

  let probes = 0;
  const server = createAppServer({
    projectRoot: PROJECT_ROOT,
    reposDir: join(PROJECT_ROOT, "repos"),
    modelProbe: async () => {
      probes += 1;
      return { present: false };
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.close();
    for (const [key, value] of [
      ["CEREBRAS_API_KEY", prev.key],
      ["SIGHTREAD_MODEL", prev.model],
      ["CEREBRAS_BASE_URL", prev.base],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/ask/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repo: PROJECT_ROOT,
      question: "What breaks if I change this file?",
      impactPath: "app/lib/impact.mjs",
    }),
  });
  assert.equal(res.status, 200);
  const events = (await res.text())
    .split("\n\n")
    .filter((block) => block.startsWith("event:"))
    .map((block) => {
      const [head, data] = block.split("\n");
      return { event: head.slice(7), data: JSON.parse(data.slice(6)) };
    });

  const done = events.find((e) => e.event === "done");
  assert.ok(done, "the stream finished");
  assert.equal(done.data.ok, true);
  assert.equal(done.data.model, "kimi-k3.1-pro");
  assert.equal(done.data.modelMismatch, false, "same model, not a fallback");
  assert.equal(typeof done.data.ttftMs, "number");
  assert.equal(done.data.usage.input, 11);
  assert.equal(probes, 0);
});
