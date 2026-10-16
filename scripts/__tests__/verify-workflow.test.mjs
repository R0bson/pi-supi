// biome-ignore-all lint/suspicious/noTemplateCurlyInString: GitHub Actions expressions are literal test data.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

function job(name) {
  return workflow.split(`\n  ${name}:\n`)[1]?.split(/^ {2}[\w-]+:\n/m)[0] ?? "";
}

const workspace = job("workspace-checks");
const tests = job("tests");
const verify = job("verify");
const gate =
  verify.match(/^ {8}run: \|\n((?: {10}.*\n)+)/m)?.[1]?.replace(/^ {10}/gm, "") ?? "exit 99";

describe("parallel verification workflow", () => {
  it("runs all non-test checks once, without waiting for the test jobs", () => {
    expect(workspace).not.toMatch(/^ {4}needs:/m);
    expect(workspace).toContain("Check release-please config coverage");
    for (const command of [
      "pnpm --filter @mrclrchtr/supi-tree-sitter check:all-wasm",
      "pnpm biome",
      "pnpm typecheck",
      "pnpm skills:check",
      "pnpm pack:verify",
    ]) {
      expect(workspace).toContain(`run: ${command}\n`);
    }
    expect(workspace).not.toMatch(/run: pnpm (?:test|verify)\n/);
  });

  it("runs four test shards with normal isolation and the required test tools", () => {
    expect(tests).not.toMatch(/^ {4}needs:/m);
    expect(tests).toContain("fail-fast: false");
    expect(tests).toContain("shard: [1, 2, 3, 4]");
    expect(tests).toContain("uses: ./.github/actions/setup-pnpm");
    expect(tests).toContain("run: sudo apt-get install -y ripgrep");
    expect(tests).toContain("run: pnpm test --shard=${{ matrix.shard }}/4");
    expect(tests).not.toMatch(/--(?:no-isolate|exclude|project|passWithNoTests)/);
    expect(tests).not.toContain("continue-on-error:");
  });

  it("keeps verify as the required result and release dependency", () => {
    expect(verify).toContain("needs: [workspace-checks, tests]");
    expect(verify).toContain("if: always()");
    expect(verify).toContain("WORKSPACE_RESULT: ${{ needs.workspace-checks.result }}");
    expect(verify).toContain("TEST_RESULT: ${{ needs.tests.result }}");
    expect(job("release-please")).toContain("needs: [actionlint, conventional-commits, verify]");
  });

  it.each([
    ["success", "success", 0],
    ["failure", "success", 1],
    ["success", "failure", 1],
    ["cancelled", "success", 1],
    ["success", "cancelled", 1],
    ["skipped", "success", 1],
    ["success", "skipped", 1],
  ])(
    "requires success from both jobs: workspace=%s tests=%s",
    (workspaceResult, testResult, status) => {
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", gate], {
        encoding: "utf8",
        env: {
          ...process.env,
          WORKSPACE_RESULT: workspaceResult,
          TEST_RESULT: testResult,
        },
      });
      expect(result.status, result.stderr).toBe(status);
    },
  );
});
