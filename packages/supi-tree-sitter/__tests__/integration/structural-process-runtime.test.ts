import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const probe = fileURLToPath(new URL("../fixtures/structural-process-probe.mjs", import.meta.url));

describe("Structural Worker parent runtimes", () => {
  it.each([
    { runtime: "Node", args: [] },
    { runtime: "compiled Bun", args: ["--compiled-parent"] },
  ])(
    "returns an outline under $runtime",
    async ({ args }) => {
      const { stdout, stderr } = await run(process.execPath, [probe, ...args], {
        timeout: 8_000,
      });

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toMatchObject({
        kind: "success",
        names: ["hello", "Greeter", "Config"],
      });
    },
    10_000,
  );

  it("restores complete outlines across multiple JSON result chunks", async () => {
    const { stdout } = await run(process.execPath, [probe, "--compiled-parent", "--large-result"], {
      timeout: 8_000,
    });
    const result = JSON.parse(stdout);
    expect(result.kind).toBe("success");
    expect(result.names).toHaveLength(4_000);
    expect(result.names[0]).toBe("item0");
    expect(result.names.at(-1)).toBe("item3999");
  }, 10_000);

  it("explains how to enable structural work when Node is missing under Bun", async () => {
    await expect(
      run(process.execPath, [probe, "--compiled-parent"], {
        env: { ...process.env, PATH: "", Path: "" },
        timeout: 8_000,
      }),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining("requires Node.js on PATH. Install Node.js and restart Pi."),
    });
  }, 10_000);
});
