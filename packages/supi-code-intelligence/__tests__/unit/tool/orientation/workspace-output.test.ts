import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createPiMock, getTool, makeCtx } from "@mrclrchtr/supi-test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import extension from "../../../../src/extension.ts";

let root: string;
let home: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "orientation-output-"));
  home = mkdtempSync(join(tmpdir(), "orientation-home-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});
function put(file: string, text: string) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}
async function orient(input: object = {}) {
  const pi = createPiMock();
  extension(pi as never, undefined, home);
  const result = (await getTool(pi, "code_orientation").execute(
    "workspace-output",
    input,
    undefined,
    undefined,
    makeCtx({ cwd: root }),
  )) as { content: Array<{ type: string; text: string }> };
  return result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

describe("workspace Orientation output", () => {
  it("keeps literal path spacing and distinguishes encoded declaration values", async () => {
    put("two  spaces.txt", "");
    put("a&b.txt", "");
    put("package.json", JSON.stringify({ name: "odd|name" }));
    const text = await orient();
    expect(text).toContain("`two  spaces.txt`");
    expect(text).toContain("`a&b.txt`");
    // biome-ignore lint/security/noSecrets: Expected JSON escape text, not a secret.
    expect(text).toContain('`"odd\\u007cname"` (JSON string)');
  });

  it("captures omitted mixed-language declarations without inventing membership", async () => {
    put("package.json", JSON.stringify({ name: "root", workspaces: ["units/*"] }));
    put("units/app/package.json", JSON.stringify({ name: "app" }));
    put(
      "service/pyproject.toml",
      ["[project]", 'name = "api"', 'description = "Data service"', ""].join("\n"),
    );
    const text = await orient({ maxResults: 1 });
    const snapshot = text.match(/Complete captured result[^`]*`([^`]+)`/)?.[1];
    expect(snapshot).toBeDefined();
    const captured = readFileSync(snapshot as string, "utf8");
    expect(captured).toContain("python-project");
    expect(captured).toContain("project.name");
    expect(captured).toContain("Data service");
    expect(captured).toContain("units/app");
    expect(captured).not.toMatch(/service.*node-workspace/);
    rmSync(dirname(snapshot as string), { recursive: true, force: true });
  });

  it("renders separate dependency categories as Mermaid edges without duplicate dependency lists", async () => {
    put("package.json", JSON.stringify({ name: "root", workspaces: ["units/*"] }));
    put(
      "units/app/package.json",
      JSON.stringify({
        name: "app",
        dependencies: { core: "workspace:*" },
        devDependencies: { core: "workspace:*" },
      }),
    );
    put("units/core/package.json", JSON.stringify({ name: "core" }));
    const text = await orient({ focus: { path: "units/app" } });
    expect(text).toContain("```mermaid");
    expect(text).toContain("dependencies: workspace:*");
    expect(text).toContain("devDependencies: workspace:*");
    expect(text.match(/ -->/g)).toHaveLength(2);
    expect(text).not.toContain("## Manifest dependencies");
  });

  it("bounds large declarations and retains the complete captured text", async () => {
    put(
      "package.json",
      JSON.stringify({ name: "root", description: "Long description ".repeat(3000) }),
    );
    const text = await orient();
    expect(text.length).toBeLessThanOrEqual(16000);
    const snapshot = text.match(/Complete captured result[^`]*`([^`]+)`/)?.[1];
    expect(snapshot).toBeDefined();
    expect(readFileSync(snapshot as string, "utf8")).toContain("Long description ".repeat(1000));
    rmSync(dirname(snapshot as string), { recursive: true, force: true });
  });

  it("orients a source-only project without requiring Node metadata", async () => {
    put("nested/source/main.py", "pass\n");
    const text = await orient();
    expect(text).toContain("1 regular file");
    expect(text).toContain(".py");
    expect(text).toContain("nested/");
    expect(text).not.toContain("No package.json");
    expect(text).not.toContain("Package topology");
  });
});
