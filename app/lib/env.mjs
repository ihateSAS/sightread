import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Parse .env text into key/value pairs without mutating process.env.
 */
export function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const stripped = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = stripped.indexOf("=");
    if (eq <= 0) continue;
    const key = stripped.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = stripped.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    } else {
      const hashIdx = val.indexOf(" #");
      if (hashIdx !== -1) val = val.slice(0, hashIdx).trim();
    }
    out[key] = val;
  }
  return out;
}

/**
 * Load a .env file into process.env without overriding variables already set in the environment.
 */
export function loadEnv(rootDir) {
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) return false;
  try {
    const parsed = parseEnv(readFileSync(envPath, "utf8"));
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined || process.env[k] === "") {
        process.env[k] = v;
      }
    }
    return true;
  } catch {
    return false;
  }
}
