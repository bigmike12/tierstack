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
 * from the agent that is actually running this install.
 */
function ensurePackageManager() {
  const agent = process.env.npm_config_user_agent ?? "";
  const match = /^(npm|yarn|pnpm|bun)\/(\d+\.\d+\.\d+)/.exec(agent);
  if (!match) return;

  const [, name, version] = match;
  const detected = `${name}@${version}`;

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
