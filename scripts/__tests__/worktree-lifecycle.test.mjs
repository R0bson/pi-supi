import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = [];

function fixture() {
  const path = mkdtempSync(join(tmpdir(), "supi-worktree-"));
  fixtures.push(path);
  expect(spawnSync("git", ["init", "--quiet", path]).status).toBe(0);
  writeFileSync(
    join(path, "package.json"),
    JSON.stringify({
      name: "@mrclrchtr/supi-workspace",
      packageManager: "pnpm@12.14.0",
    }),
  );
  writeFileSync(join(path, "pnpm-workspace.yaml"), "packages: []\n");
  writeFileSync(join(path, "pnpm-lock.yaml"), "fixture lockfile\n");
  const log = join(path, "calls.log");
  writeFileSync(
    join(path, "pnpm"),
    `#!/usr/bin/env bash
if [[ "$*" == --version ]]; then
  printf '%s\\n' "\${FAKE_VERSION:-12.14.0}"
  exit 0
fi
printf '%s\\n' "$*" >> "$CALL_LOG"
if [[ "$*" == 'install --frozen-lockfile' ]]; then exit "\${FAKE_FAILURE:-0}"; fi
if [[ "$*" == *check:all-wasm ]]; then exit "\${FAKE_WASM_FAILURE:-0}"; fi
`,
  );
  chmodSync(join(path, "pnpm"), 0o755);
  return { path, log };
}

function run(script, target, extra = {}) {
  return spawnSync("bash", [join(root, "scripts", script), target.path], {
    cwd: tmpdir(),
    encoding: "utf8",
    env: {
      ...process.env,
      ORCA_WORKTREE_PATH: "/not-used-with-explicit-target",
      PATH: `${target.path}:${process.env.PATH}`,
      CALL_LOG: target.log,
      ...extra,
    },
  });
}

afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("portable worktree lifecycle adapters", () => {
  it("repeats locked setup for an explicit target without Orca or Worktrunk", () => {
    const target = fixture();
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = run("worktree-setup.sh", target);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("worktree ready:");
    }
    expect(readFileSync(target.log, "utf8").trim().split("\n")).toEqual([
      "install --frozen-lockfile",
      "exec tsc --version",
      "exec vitest --version",
      "--filter @mrclrchtr/supi-tree-sitter check:all-wasm",
      "install --frozen-lockfile",
      "exec tsc --version",
      "exec vitest --version",
      "--filter @mrclrchtr/supi-tree-sitter check:all-wasm",
    ]);
  });

  it("propagates install failure, then permits retry on the same checkout", () => {
    const target = fixture();
    const result = run("worktree-setup.sh", target, { FAKE_FAILURE: "9" });
    expect(result.status).toBe(9);
    expect(result.stderr).toContain("install locked workspace dependencies");
    expect(result.stdout).not.toContain("worktree ready:");
    expect(run("worktree-setup.sh", target).status).toBe(0);
  });

  it("rejects the wrong pnpm version before installation", () => {
    const target = fixture();
    const result = run("worktree-setup.sh", target, { FAKE_VERSION: "0.0.0" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Use pnpm 12.14.0");
  });

  it("does not report readiness when the WASM check fails", () => {
    const target = fixture();
    const result = run("worktree-setup.sh", target, { FAKE_WASM_FAILURE: "7" });
    expect(result.status).toBe(7);
    expect(result.stderr).toContain("check vendored WASM readiness");
    expect(result.stdout).not.toContain("worktree ready:");
  });

  it("rejects non-root targets for setup and archive", () => {
    const target = fixture();
    target.path = join(target.path, ".git");
    expect(run("worktree-setup.sh", target).status).not.toBe(0);
    expect(run("worktree-archive.sh", target).status).not.toBe(0);
  });

  it("keeps setup operations in separate checkout directories", () => {
    const first = fixture();
    const second = fixture();
    expect(run("worktree-setup.sh", first).status).toBe(0);
    expect(run("worktree-setup.sh", second).status).toBe(0);
    expect(first.path).not.toBe(second.path);
    expect(readFileSync(first.log, "utf8")).toBe(readFileSync(second.log, "utf8"));
  });

  it("archives repeatedly without changing checkout contents", () => {
    const target = fixture();
    const sentinel = join(target.path, "local-data");
    writeFileSync(sentinel, "preserve");
    expect(run("worktree-archive.sh", target).status).toBe(0);
    expect(run("worktree-archive.sh", target).status).toBe(0);
    expect(readFileSync(sentinel, "utf8")).toBe("preserve");
    expect(readFileSync(join(target.path, "pnpm-lock.yaml"), "utf8")).toBe("fixture lockfile\n");
  });
});
