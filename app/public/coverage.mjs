/**
 * The blind-spot number, computed in one place.
 *
 * The page imports this file directly (no build step) and the node tests
 * import the same module, so the count the UI prints is the count the tests
 * check. Pure functions only: no DOM, no filesystem.
 */

const REF =
  /([\w./-]+\.(?:js|mjs|cjs|ts|tsx|jsx|py|go|rs|rb|java|kt|cc|cpp|h|c|php|swift|ex|exs))(?::\d+)?/g;

/** File paths an answer cites, without line numbers or a leading ./. */
export function refsInAnswer(text) {
  const refs = new Set();
  for (const m of String(text || "").matchAll(REF)) refs.add(m[1].replace(/^\.\//, ""));
  return refs;
}

/**
 * Downstream files in a computed impact, each listed once.
 *
 * impact.transitive repeats the direct importers at depth 1, so keeping only
 * deeper entries keeps the direct list authoritative and avoids double-counting.
 */
export function downstreamFiles(impact) {
  if (impact?.mode !== "impact") return [];
  const indirect = (impact.transitive || []).filter((t) => t.depth > 1);
  return [...(impact.direct || []), ...indirect].map((x) => x.path);
}

/** True when there is anything to compare against the unaided answer. */
export function hasDownstream(impact) {
  return downstreamFiles(impact).length > 0;
}

/**
 * Of the files the graph lists, how many does the same model name with the
 * graph in its prompt, and how many with nothing but the repository?
 */
export function coverageOf(impact, aidedText, unaidedText) {
  const paths = downstreamFiles(impact);
  const graph = new Set(paths);
  const byBase = new Map();
  for (const p of paths) {
    const base = p.split("/").pop();
    if (!byBase.has(base)) byBase.set(base, p);
  }
  const hits = (refs) => {
    const named = new Set();
    for (const ref of refs) {
      const file = graph.has(ref) ? ref : byBase.get(ref.split("/").pop());
      if (file) named.add(file);
    }
    return named.size;
  };
  return {
    graph: graph.size,
    withGraph: hits(refsInAnswer(aidedText)),
    alone: hits(refsInAnswer(unaidedText)),
  };
}
