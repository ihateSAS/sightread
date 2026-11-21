/**
 * Change-impact engine.
 *
 * Answers one question with evidence: "if I change this file, what breaks?"
 *
 * The graph is parsed from real import statements, so every dependent listed
 * here is a file that actually imports from the target — not a model's guess
 * about coupling. Depth is the number of import hops away, which is why the
 * UI can say "3 direct, 11 at depth 2" instead of "probably a lot".
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", "coverage",
  "vendor", "target", "__pycache__", ".venv", "venv", ".turbo", ".cache",
]);

const LANGS = {
  ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".jsx": "JavaScript",
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".py": "Python", ".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".java": "Java",
  ".kt": "Kotlin", ".c": "C", ".h": "C", ".cc": "C++", ".cpp": "C++", ".cs": "C#",
  ".php": "PHP", ".swift": "Swift", ".ex": "Elixir", ".exs": "Elixir",
};

const MAX_FILES = 4000;
const MAX_DEPTH = 7;
const MAX_TRANSITIVE = 40;

async function walkFiles(root) {
  const out = [];
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length && out.length < MAX_FILES) {
    const { dir, depth } = queue.shift();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) break;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        if (depth + 1 > MAX_DEPTH) continue;
        queue.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile() && LANGS[extname(entry.name)]) {
        out.push(full);
      }
    }
  }
  return out;
}

const JS_IMPORT = /(?:^\s*import[^'"]*from\s+["']([^"']+)["'])|(?:require\(\s*["']([^"']+)["']\s*\))|(?:import\(\s*["']([^"']+)["']\s*\))/gm;
const PY_FROM = /^\s*from\s+([\w.]+)\s+import\s/gm;
const PY_IMPORT = /^\s*import\s+([\w.]+)/gm;

function importSpecs(source, file) {
  const ext = extname(file);
  const specs = [];
  if ([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts"].includes(ext)) {
    for (const m of source.matchAll(JS_IMPORT)) {
      const spec = m[1] || m[2] || m[3];
      if (spec) specs.push({ spec, line: source.slice(0, m.index).split("\n").length });
    }
  } else if (ext === ".py") {
    for (const re of [PY_FROM, PY_IMPORT]) {
      for (const m of source.matchAll(re)) specs.push({ spec: m[1], line: 0 });
    }
  }
  return specs;
}

const CANDIDATE_SUFFIXES = ["", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", "/index.js", "/index.ts", "/index.tsx"];

function resolveSpecifier(spec, fromFile, known) {
  if (!spec || !spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const suffix of CANDIDATE_SUFFIXES) {
    if (known.has(base + suffix)) return base + suffix;
  }
  return null;
}

/** Parses the repo once and returns { dependents: Map<file, Set<importer>> }. */
export async function buildImportGraph(repoPath) {
  const files = await walkFiles(repoPath);
  const known = new Set(files);
  const dependents = new Map();
  const languages = {};
  let imports = 0;

  for (const file of files) {
    languages[LANGS[extname(file)]] = (languages[LANGS[extname(file)]] || 0) + 1;
    let source;
    try {
      source = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const { spec, line } of importSpecs(source, file)) {
      const target = resolveSpecifier(spec, file, known);
      if (!target || target === file) continue;
      imports += 1;
      if (!dependents.has(target)) dependents.set(target, new Map());
      dependents.get(target).set(file, line);
    }
  }

  return { repoPath, files, languages, imports, dependents };
}

/** Everything that transitively imports the target, with hop distance. */
export function impactOf(graph, targetRelPath) {
  const target = resolve(graph.repoPath, targetRelPath);
  const rel = (p) => relative(graph.repoPath, p);

  const direct = [...(graph.dependents.get(target)?.entries() || [])]
    .map(([file, line]) => ({ path: rel(file), line }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const seen = new Map();
  const queue = direct.map((d) => ({ file: resolve(graph.repoPath, d.path), depth: 1 }));
  for (const d of direct) seen.set(d.path, 1);

  while (queue.length && seen.size < MAX_TRANSITIVE) {
    const { file, depth } = queue.shift();
    for (const [importer] of graph.dependents.get(file) || []) {
      const r = rel(importer);
      if (r === targetRelPath || seen.has(r)) continue;
      seen.set(r, depth + 1);
      queue.push({ file: importer, depth: depth + 1 });
    }
  }

  const transitive = [...seen.entries()]
    .filter(([p]) => p !== targetRelPath)
    .map(([path, depth]) => ({ path, depth }))
    .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));

  const byDepth = {};
  for (const item of transitive) byDepth[item.depth] = (byDepth[item.depth] || 0) + 1;

  // risk is deliberately simple and explainable: breadth, not vibes
  const score = Math.min(100, direct.length * 12 + Math.max(0, transitive.length - direct.length) * 3);

  return {
    ok: true,
    target: { path: targetRelPath, name: basename(targetRelPath), lang: LANGS[extname(targetRelPath)] || "other" },
    direct,
    transitive,
    byDepth,
    risk: { score, level: score >= 60 ? "high" : score >= 25 ? "medium" : "low" },
    stats: { files: graph.files.length, imports: graph.imports, languages: graph.languages },
  };
}

/** The files with the most dependents — good defaults for "what should I look at". */
export function hottestFiles(graph, limit = 6) {
  return [...graph.dependents.entries()]
    .map(([file, importers]) => ({ path: relative(graph.repoPath, file), dependents: importers.size }))
    .sort((a, b) => b.dependents - a.dependents || a.path.localeCompare(b.path))
    .slice(0, limit);
}
