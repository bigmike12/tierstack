import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRootEnv, requireEnv } from "./env";

function workspace(envContents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "tierstack-env-"));
  writeFileSync(join(dir, "turbo.json"), "{}");
  writeFileSync(join(dir, ".env"), envContents);
  return dir;
}

const touched: string[] = [];
function track(...keys: string[]): void {
  touched.push(...keys);
}

afterEach(() => {
  for (const key of touched.splice(0)) delete process.env[key];
});

describe("root env loading", () => {
  it("loads values from the repo root .env", () => {
    track("TB_TEST_URL", "TB_TEST_PLAIN");
    const dir = workspace('TB_TEST_URL="postgres://x"\nTB_TEST_PLAIN=hello\n');
    expect(loadRootEnv(dir)).toBe(join(dir, ".env"));
    expect(process.env.TB_TEST_URL).toBe("postgres://x");
    expect(process.env.TB_TEST_PLAIN).toBe("hello");
  });

  it("finds the root from a nested working directory", () => {
    track("TB_TEST_NESTED");
    const dir = workspace("TB_TEST_NESTED=found\n");
    expect(loadRootEnv(join(dir, "apps", "api", "src"))).toBe(join(dir, ".env"));
    expect(process.env.TB_TEST_NESTED).toBe("found");
  });

  it("never overrides a value the environment already provides", () => {
    track("TB_TEST_EXISTING");
    process.env.TB_TEST_EXISTING = "from-deployment";
    loadRootEnv(workspace("TB_TEST_EXISTING=from-file\n"));
    expect(process.env.TB_TEST_EXISTING).toBe("from-deployment");
  });

  it("ignores comments and blank lines", () => {
    track("TB_TEST_AFTER_COMMENT");
    loadRootEnv(workspace("# a comment\n\nTB_TEST_AFTER_COMMENT=yes\n"));
    expect(process.env.TB_TEST_AFTER_COMMENT).toBe("yes");
  });

  it("returns null when there is no .env to load", () => {
    const dir = mkdtempSync(join(tmpdir(), "tierstack-noenv-"));
    expect(loadRootEnv(dir)).toBeNull();
  });

  it("explains what to do when a required variable is missing", () => {
    expect(() => requireEnv("TB_TEST_ABSENT")).toThrow(/setup:env|setup|\.env/);
  });
});
