import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, join, relative, resolve, sep } from "node:path";

export function runCommand(cmd, args, opts = {}) {
  return new Promise((res) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => res({ code: -1, stdout: out, stderr: String(e) }));
    child.on("close", (code) => res({ code, stdout: out, stderr: err }));
  });
}

/**
 * Accepts full https/http/ssh git URLs or `owner/repo` shorthand.
 * Rejects leading dashes or unsafe schemes.
 */
export function normalizeRepoUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("url is required");
  if (raw.startsWith("-")) throw new Error("invalid repository URL");
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/.test(raw)) {
    const clean = raw.replace(/\.git$/, "");
    return `https://github.com/${clean}.git`;
  }
  if (/^https?:\/\/[^\s]+$/i.test(raw) || /^git@github\.com:[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/i.test(raw)) {
    return raw;
  }
  throw new Error("use an https://, http://, git@github.com:, or owner/repo repository reference");
}

export function slugFromUrl(url) {
  const clean = String(url || "").trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const m =
    clean.match(/(?:github\.com[/:])([^/]+)\/([^/?#]+)/i) ||
    clean.match(/^https?:\/\/[^/]+\/(.+?)\/([^/?#]+)$/i) ||
    clean.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) return null;
  const owner = m[1].replace(/[^a-zA-Z0-9_.-]/g, "-");
  const name = m[2].replace(/[^a-zA-Z0-9_.-]/g, "-");
  if (!owner || !name || owner === "." || owner === ".." || name === "." || name === "..") return null;
  return `${owner}__${name}`.slice(0, 80);
}

export async function prepareRepo(url, reposDir) {
  const normalized = normalizeRepoUrl(url);
  const slug = slugFromUrl(normalized);
  if (!slug) throw new Error("could not parse a repo name from that URL");
  const dest = join(reposDir, slug);
  const exists = await stat(dest).then((s) => s.isDirectory()).catch(() => false);
  if (exists) return { path: dest, slug, cloned: false };

  const r = await runCommand(
    "git",
    ["clone", "--depth", "1", "--quiet", "--", normalized, dest],
    { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }
  );
  if (r.code !== 0) {
    throw new Error(`git clone failed: ${(r.stderr || r.stdout || "unknown error").slice(0, 400)}`);
  }
  return { path: dest, slug, cloned: true };
}

export async function listAvailableRepos(projectRoot, reposDir) {
  const items = [
    {
      name: `${basename(projectRoot)} (this repo)`,
      slug: basename(projectRoot),
      path: projectRoot,
      local: true,
    },
  ];

  const entries = await readdir(reposDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const full = join(reposDir, entry.name);
    items.push({
      name: entry.name.replace("__", "/"),
      slug: entry.name,
      path: full,
      local: false,
    });
  }
  return items;
}

/**
 * Safely resolve and read a snippet from a cited file inside an allowed repository directory.
 */
export async function readCitedFile({ repoInput, filePath, line = 1, endLine = null, context = 10, projectRoot, reposDir }) {
  const repoTarget = resolve(repoInput || projectRoot);
  const repoReal = await realpath(repoTarget).catch(() => null);
  if (!repoReal) throw new Error("repository path does not exist");

  const allowedRoots = [await realpath(projectRoot).catch(() => resolve(projectRoot))];
  const reposReal = await realpath(reposDir).catch(() => null);
  if (reposReal) allowedRoots.push(reposReal);

  const isWithin = (child, parent) => child === parent || child.startsWith(parent + sep);
  const repoAllowed = allowedRoots.some((root) => isWithin(repoReal, root));
  if (!repoAllowed) {
    throw new Error("file inspection is scoped to the workspace and cloned repos/");
  }

  const cleanRel = String(filePath || "").replace(/^\/+/, "");
  if (!cleanRel || cleanRel.includes("\0")) throw new Error("invalid file path");

  const candidate = resolve(repoReal, cleanRel);
  const fileReal = await realpath(candidate).catch(() => null);
  if (!fileReal || !isWithin(fileReal, repoReal)) {
    throw new Error("file not found inside repository");
  }

  const st = await stat(fileReal).catch(() => null);
  if (!st || !st.isFile()) throw new Error("target is not a file");
  if (st.size > 512 * 1024) throw new Error("file exceeds 512 KB preview limit");

  const buf = await readFile(fileReal);
  if (buf.includes(0)) throw new Error("binary files cannot be previewed");

  const allLines = buf.toString("utf8").split(/\r?\n/);
  const focusStart = Math.max(1, Math.min(allLines.length, Number(line) || 1));
  const focusEnd = Math.max(focusStart, Math.min(allLines.length, Number(endLine) || focusStart));
  const pad = Math.max(0, Math.min(40, Number(context) || 10));
  const sliceStart = Math.max(1, focusStart - pad);
  const sliceEnd = Math.min(allLines.length, focusEnd + pad);

  const lines = [];
  for (let n = sliceStart; n <= sliceEnd; n++) {
    lines.push({
      number: n,
      text: allLines[n - 1],
      highlighted: n >= focusStart && n <= focusEnd,
    });
  }

  return {
    path: relative(repoReal, fileReal).split(sep).join("/"),
    totalLines: allLines.length,
    focusStart,
    focusEnd,
    sliceStart,
    sliceEnd,
    lines,
  };
}
