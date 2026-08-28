import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The monorepo keeps a single .env at its root. Next only looks in its own
 * directory, so the root file is loaded here — without overwriting anything the
 * shell already set.
 */
function loadRootEnv() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  for (const file of [".env.local", ".env"]) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

loadRootEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The portal imports the shared money helpers straight from monorepo source
  // rather than a build artefact.
  transpilePackages: ["@tierstack/shared"],
  eslint: { ignoreDuringBuilds: true },
  env: {
    API_URL: process.env.API_URL ?? "http://localhost:4000",
    BILLING_ENV: process.env.BILLING_ENV ?? "test",
    PORTAL_URL: process.env.PORTAL_URL ?? "http://localhost:3001",
  },
};

export default nextConfig;
