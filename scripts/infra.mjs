#!/usr/bin/env node
/**
 * Makes sure PostgreSQL and Redis are actually up before anything tries to talk
 * to them.
 *
 * The failure this prevents is a bad one to debug: Prisma reports `P1001: Can't
 * reach database server`, which reads like a configuration problem when the real
 * answer is almost always "the container is not running". This checks the ports
 * the app will genuinely use — read from .env, not assumed — starts the compose
 * stack if it can, and if it cannot, says which of the three possible reasons
 * applies instead of leaving you to guess.
 *
 *   node scripts/infra.mjs          check, start if needed, exit
 *   node scripts/infra.mjs --check  check only, never start
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const checkOnly = process.argv.includes("--check");

const services = [
  { name: "PostgreSQL", ...target("DATABASE_URL", 5432) },
  { name: "Redis", ...target("REDIS_URL", 6379) },
];

const down = [];
for (const service of services) {
  if (await reachable(service.host, service.port)) {
    log(`${service.name} is up on ${service.host}:${service.port}`);
  } else {
    down.push(service);
  }
}

if (down.length === 0) process.exit(0);

const names = down.map((s) => s.name).join(" and ");
if (checkOnly) {
  fail(`${names} ${down.length === 1 ? "is" : "are"} not reachable.`);
}

log(`${names} ${down.length === 1 ? "is" : "are"} not reachable — trying Docker.`);
await startDocker(down);

// ---------------------------------------------------------------------------

/**
 * Reads a host and port out of a connection URL in .env. Falling back to a
 * default is fine; guessing when the developer has configured something else is
 * not, which is why this parses rather than assumes.
 */
function target(variable, defaultPort) {
  const fromEnv = process.env[variable] ?? fromDotEnv(variable);
  if (fromEnv) {
    try {
      const url = new URL(fromEnv);
      return { host: url.hostname || "127.0.0.1", port: Number(url.port) || defaultPort };
    } catch {
      // A malformed URL is the app's problem to report, not this script's.
    }
  }
  return { host: "127.0.0.1", port: defaultPort };
}

function fromDotEnv(variable) {
  const path = join(root, ".env");
  if (!existsSync(path)) return null;
  const match = new RegExp(`^${variable}=(.*)$`, "m").exec(readFileSync(path, "utf8"));
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

/** A TCP connect is the only check that answers the question being asked. */
function reachable(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function startDocker(missing) {
  if (!existsSync(join(root, "docker-compose.yml"))) {
    fail(
      "There is no docker-compose.yml here, so nothing can be started automatically.\n" +
        `Start ${missing.map((s) => s.name).join(" and ")} yourself, then run this again.`
    );
  }

  if (!commandExists("docker")) {
    fail(
      "Docker is not installed, so the containers cannot be started.\n\n" +
        "Either install Docker Desktop, or run the two services natively:\n" +
        "  brew install postgresql@16 redis\n" +
        "  brew services start postgresql@16 && brew services start redis\n" +
        "  createuser -s tierstack && createdb -O tierstack tierstack\n" +
        "  psql -d tierstack -c \"ALTER USER tierstack WITH PASSWORD 'tierstack';\""
    );
  }

  const info = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (info.status !== 0) {
    fail(
      "Docker is installed but its daemon is not responding.\n\n" +
        "If you run these in Docker: open Docker Desktop, wait for the whale icon to stop\n" +
        "animating, then run this again.\n\n" +
        "If you run them natively instead:\n" +
        "  brew services start postgresql@16 && brew services start redis"
    );
  }

  const up = spawnSync("docker", ["compose", "up", "-d"], { cwd: root, stdio: "inherit" });
  if (up.status !== 0) {
    fail(
      "`docker compose up -d` failed — the output above says why.\n" +
        "An input/output error there means Docker's own disk is damaged: quit Docker Desktop,\n" +
        "reopen it, and if that does not help use Troubleshoot -> Clean / Purge data."
    );
  }

  await waitFor(missing);
}

/**
 * A container reports "started" well before Postgres is accepting connections,
 * so the wait is on the port rather than on Docker's own idea of readiness.
 */
async function waitFor(missing, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  const pending = [...missing];

  while (pending.length > 0 && Date.now() < deadline) {
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const service = pending[i];
      if (await reachable(service.host, service.port, 800)) {
        log(`${service.name} is up on ${service.host}:${service.port}`);
        pending.splice(i, 1);
      }
    }
    if (pending.length > 0) await sleep(1000);
  }

  if (pending.length > 0) {
    fail(
      `${pending.map((s) => s.name).join(" and ")} did not come up within ${timeoutMs / 1000}s.\n` +
        "Check `docker compose logs` for what the container is complaining about."
    );
  }
}

function commandExists(name) {
  try {
    execFileSync("command", ["-v", name], { shell: "/bin/sh", stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Function declarations, not const arrows: the top-level checks above run
// before these lines are reached.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  console.log(`\x1b[2m[infra]\x1b[0m ${message}`);
}

function fail(message) {
  console.error(`\n\x1b[31m[infra]\x1b[0m ${message}\n`);
  process.exit(1);
}
