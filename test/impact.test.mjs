import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildImportGraph, hottestFiles, impactOf } from "../app/lib/impact.mjs";
import { impactEvidence } from "../app/server.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sightread-impact-"));
  mkdirSync(join(root, "lib"), { recursive: true });
  // c -> a -> b, and d -> b, so b has two direct dependents and one at depth 2
  writeFileSync(join(root, "lib", "b.js"), "export const b = 1;\n");
  writeFileSync(join(root, "lib", "a.js"), "import { b } from './b.js';\nexport const a = b;\n");
  writeFileSync(join(root, "lib", "c.js"), "import { a } from './a.js';\nconsole.log(a);\n");
  writeFileSync(join(root, "d.js"), "const { b } = require('./lib/b.js');\n");
  writeFileSync(join(root, "lonely.js"), "export const x = 1;\n");
  return root;
}

test("impact walks real imports: direct, transitive, and depth", async () => {
  const root = fixture();
  try {
    const graph = await buildImportGraph(root);
    assert.equal(graph.files.length, 5);
    assert.ok(graph.imports >= 3);

    const impact = impactOf(graph, "lib/b.js");
    assert.deepEqual(impact.direct.map((d) => d.path).sort(), ["d.js", "lib/a.js"]);

    const byPath = Object.fromEntries(impact.transitive.map((t) => [t.path, t.depth]));
    assert.equal(byPath["lib/a.js"], 1);
    assert.equal(byPath["d.js"], 1);
    assert.equal(byPath["lib/c.js"], 2, "c reaches b through a");
    assert.equal(byPath["lonely.js"], undefined, "unrelated files are not reported");

    assert.ok(["low", "medium", "high"].includes(impact.risk.level));
    assert.equal(impact.target.name, "b.js");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a leaf with no dependents reports an empty, low-risk impact", async () => {
  const root = fixture();
  try {
    const graph = await buildImportGraph(root);
    const impact = impactOf(graph, "lonely.js");
    assert.equal(impact.direct.length, 0);
    assert.equal(impact.transitive.length, 0);
    assert.equal(impact.risk.level, "low");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a change question resolves to the file it names", async () => {
  const root = fixture();
  try {
    const ev = await impactEvidence(root, "what breaks if I change lib/b.js?", null);
    assert.equal(ev.mode, "impact");
    assert.equal(ev.target.path, "lib/b.js");
    assert.deepEqual(ev.direct.map((d) => d.path).sort(), ["d.js", "lib/a.js"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("only change questions get a graph lookup", async () => {
  const root = fixture();
  try {
    assert.equal(await impactEvidence(root, "how does the parser work?", null), null);

    const hubs = await impactEvidence(root, "which files are load-bearing?", null);
    assert.equal(hubs.mode, "hubs", "a change question with no file gets the hub ranking");
    assert.ok(hubs.hot.length > 0);

    const missing = await impactEvidence(root, "what breaks if I delete nope.js", null);
    assert.equal(missing.mode, "hubs", "an unknown path is not reported as zero impact");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hottestFiles ranks by dependent count", async () => {
  const root = fixture();
  try {
    const graph = await buildImportGraph(root);
    const hot = hottestFiles(graph, 3);
    assert.equal(hot[0].path, "lib/b.js", "b has two dependents");
    assert.equal(hot[0].dependents, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
