import test from "node:test";
import assert from "node:assert/strict";
import {
  coverageOf,
  downstreamFiles,
  hasDownstream,
  refsInAnswer,
} from "../app/public/coverage.mjs";

const impact = {
  mode: "impact",
  target: { path: "lib/express.js" },
  direct: [{ path: "lib/express.js", line: 18 }],
  transitive: [
    { path: "lib/express.js", depth: 1 },
    { path: "lib/application.js", depth: 2 },
    { path: "lib/router/index.js", depth: 3 },
  ],
};

test("refsInAnswer keeps file paths and drops line numbers and ./ prefixes", () => {
  const refs = refsInAnswer("see ./lib/application.js:42 and lib/express.js, not `npm test`");
  assert.deepEqual([...refs].sort(), ["lib/application.js", "lib/express.js"]);
});

test("downstreamFiles counts each downstream file once", () => {
  assert.deepEqual(downstreamFiles(impact), [
    "lib/express.js",
    "lib/application.js",
    "lib/router/index.js",
  ]);
});

test("downstreamFiles and hasDownstream ignore evidence that is not impact", () => {
  assert.deepEqual(downstreamFiles(null), []);
  assert.deepEqual(downstreamFiles({ mode: "hubs", hot: [{ path: "a.js", dependents: 9 }] }), []);
  assert.equal(hasDownstream(null), false);
  assert.equal(hasDownstream({ mode: "hubs", hot: [] }), false);
});

test("hasDownstream is false when the graph has no downstream files", () => {
  assert.equal(
    hasDownstream({ mode: "impact", direct: [], transitive: [] }),
    false
  );
  assert.equal(
    hasDownstream({
      mode: "impact",
      direct: [],
      transitive: [{ path: "lib/express.js", depth: 1 }],
    }),
    false,
    "depth-1 entries are the direct list, not new downstream files"
  );
  assert.equal(hasDownstream(impact), true);
});

test("coverageOf counts files named with the graph versus alone", () => {
  const coverage = coverageOf(
    impact,
    "Changing lib/express.js breaks lib/application.js and lib/router/index.js.",
    "Changing lib/express.js probably affects application and router."
  );
  assert.deepEqual(coverage, { graph: 3, withGraph: 3, alone: 1 });
});

test("coverageOf matches a bare basename and does not count repeats twice", () => {
  const coverage = coverageOf(
    impact,
    "lib/express.js, express.js, application.js, application.js",
    "index.js, totally-unrelated.js"
  );
  assert.deepEqual(coverage, { graph: 3, withGraph: 2, alone: 1 });
});

test("coverageOf reports an empty graph instead of implying coverage", () => {
  assert.deepEqual(
    coverageOf({ mode: "impact", direct: [], transitive: [] }, "a.js", "b.js"),
    { graph: 0, withGraph: 0, alone: 0 }
  );
  assert.deepEqual(coverageOf(null, "a.js", "b.js"), {
    graph: 0,
    withGraph: 0,
    alone: 0,
  });
});
