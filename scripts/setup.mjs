#!/usr/bin/env node
/**
 * First-install setup. Runs from `postinstall`, is idempotent, and never
 * overwrites something a developer already configured.
 *
 * Two jobs:
 *   1. Create a local `.env` from `.env.example`, with real random secrets
 *      rather than the placeholders.
 *   2. Record which package manager this repo is being used with, because
 *      Turborepo needs to be told and the answer differs per developer.
 *
 * It is skipped entirely in CI and production, where the environment is
 * provided rather than scaffolded.
 */
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

if (process.env.CI || process.env.NODE_ENV === "production") {
  process.exit(0);
}

const notes = [];
ensureEnvFile();
ensurePackageManager();

if (notes.length > 0) {
  console.log(`\n${notes.join("\n")}\n`);
}

// ---------------------------------------------------------------------------

function ensureEnvFile() {
  const envPath = join(root, ".env");
  const examplePath = join(root, ".env.example");

  if (existsSync(envPath)) return;
  if (!existsSync(examplePath)) {
    console.warn("[setup] .env.example is missing; skipping .env creation.");
    return;
  }

  copyFileSync(examplePath, envPath);
  let contents = readFileSync(envPath, "utf8");
  contents = contents.replace(
    /^SESSION_SECRET=.*$/m,
    `SESSION_SECRET="${randomBytes(48).toString("base64")}"`
  );
  contents = contents.replace(
    /^ENCRYPTION_KEY=.*$/m,
    `ENCRYPTION_KEY="${randomBytes(32).toString("hex")}"`
  );
  writeFileSync(envPath, contents);

  notes.push(
    "[setup] Created .env from .env.example, with generated SESSION_SECRET and",
    "        ENCRYPTION_KEY. ENCRYPTION_KEY seals stored payment-provider",
    "        credentials — back it up before configuring a real provider, because",
    "        changing it makes existing credentials undecryptable."
  );
}

/**
 * Turborepo refuses to resolve the workspace unless package.json declares the
 * package manager. Rather than pinning one and breaking everyone else, take it
 * from whichever manager is actually being used here.
 *
 * Detection order:
 *   1. `--pm=name@version`, for switching deliberately.
 *   2. The agent running this install — the normal path.
 *   3. A lockfile already in the repo, for a direct `node scripts/setup.mjs`.
 *
 * The third case matters because yarn and pnpm refuse to run at all against a
 * package.json pinned to a different manager — including the install that would
 * have corrected it. Running this script directly is the way out of that.
 */
function ensurePackageManager() {
  const detected = detectPackageManager();
  if (!detected) return;

  const packagePath = join(root, "package.json");
  const raw = readFileSync(packagePath, "utf8");
  const pkg = JSON.parse(raw);

  if (pkg.packageManager === detected) return;

  const previous = pkg.packageManager;
  pkg.packageManager = detected;

  // Preserve the file's existing indentation so the diff stays small.
  const indent = /\n(\s+)"/.exec(raw)?.[1] ?? "  ";
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, indent)}\n`);

  notes.push(
    previous
      ? `[setup] packageManager updated: ${previous} -> ${detected} (Turborepo needs this).`
      : `[setup] packageManager set to ${detected} (Turborepo needs this).`
  );
}

function detectPackageManager() {
  const explicit = process.argv.find((arg) => arg.startsWith("--pm="));
  if (explicit) {
    const value = explicit.slice("--pm=".length);
    if (/^(npm|yarn|pnpm|bun)@\d+\.\d+\.\d+$/.test(value)) return value;
    console.warn(`[setup] Ignoring --pm=${value}; expected something like --pm=yarn@1.22.22.`);
  }

  const agent = process.env.npm_config_user_agent ?? "";
  const fromAgent = /^(npm|yarn|pnpm|bun)\/(\d+\.\d+\.\d+)/.exec(agent);
  if (fromAgent) return `${fromAgent[1]}@${fromAgent[2]}`;

  // No agent means this was run directly. Fall back to whichever lockfile is
  // present, and ask that manager its own version.
  const lockfiles = [
    ["yarn.lock", "yarn"],
    ["pnpm-lock.yaml", "pnpm"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ];
  for (const [file, name] of lockfiles) {
    if (!existsSync(join(root, file))) continue;
    try {
      const version = execFileSync(name, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
        .trim()
        .replace(/^v/, "");
      if (/^\d+\.\d+\.\d+$/.test(version)) return `${name}@${version}`;
    } catch {
      // That manager is not installed here; try the next lockfile.
    }
  }
  return null;
}
