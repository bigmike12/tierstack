import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * Two URLs are baked into this build, and both have to be real.
 *
 * SITE_URL is where this site lives — it is what `metadataBase` uses to turn
 * every Open Graph and Twitter path into an absolute URL. Get it wrong and the
 * link previews on WhatsApp, Slack and X silently render nothing.
 *
 * APP_URL is where "Start building" goes. Get it wrong and every button on the
 * site is dead.
 *
 * There is no `.env` file on a hosting platform, so the localhost defaults
 * below would apply silently in production and both failures would ship
 * looking fine. A production build therefore refuses to start without them —
 * a build that fails on the deploy dashboard costs a minute; a site whose
 * buttons point at localhost costs whoever clicked one.
 */
const isProductionBuild = process.env.NODE_ENV === "production";

function required(name, localDefault) {
  const value = process.env[name];
  if (value) return value;
  if (isProductionBuild) {
    throw new Error(
      `${name} is not set. A production build needs it — without it the site ships ` +
        `pointing at ${localDefault}. Set it in the hosting platform's environment.`
    );
  }
  return localDefault;
}

const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  env: {
    APP_URL: required("APP_URL", "http://localhost:3000"),
    SITE_URL: required("SITE_URL", "http://localhost:3002"),
  },
};

export default nextConfig;
