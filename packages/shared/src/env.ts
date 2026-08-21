import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Loads the monorepo's root `.env` into `process.env`.
 *
 * Every entrypoint calls this as its first import, so environment loading does
 * not depend on a `--env-file` flag in a package script. That matters because
 * those flags are easy to forget, and because they make the repo behave
 * differently under npm, yarn, pnpm and a direct `tsx` invocation.
 *
 * Values already present in the environment always win — a real deployment sets
 * them properly and must never be overridden by a stray local file.
 */
export function loadRootEnv(startDir: string = process.cwd()): string | null {
  const envPath = findRootEnv(startDir);
  if (!envPath) return null;

  // Node 20.12+/21.7+ can do this natively; the manual parse is the fallback.
  const nodeLoad = (process as { loadEnvFile?: (path: string) => void }).loadEnvFile;
  if (typeof nodeLoad === "function") {
    const before = { ...process.env };
    try {
      nodeLoad.call(process, envPath);
      // Node's loader overwrites; restore anything that was already set.
      for (const [key, value] of Object.entries(before)) {
        if (value !== undefined) process.env[key] = value;
      }
      return envPath;
    } catch {
      // Fall through to the manual parser.
    }
  }

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    const key = match?.[1];
    if (!key) continue;
    if (process.env[key] !== undefined) continue;
    let value = (match[2] ?? "").trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  return envPath;
}

/**
 * Walks up from `startDir` looking for the repo root — identified by a
 * `turbo.json` beside a `package.json` — and returns the `.env` there.
 * Falls back to the nearest `.env` found on the way up.
 */
function findRootEnv(startDir: string): string | null {
  let current = resolve(startDir);
  let fallback: string | null = null;

  for (let depth = 0; depth < 12; depth += 1) {
    const candidate = join(current, ".env");
    if (existsSync(candidate)) {
      if (existsSync(join(current, "turbo.json"))) return candidate;
      fallback ??= candidate;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fallback;
}

/** Throws a message that says what to do, rather than a bare undefined later. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Run \`npm run setup\` (or copy .env.example to .env) and fill it in.`
    );
  }
  return value;
}
