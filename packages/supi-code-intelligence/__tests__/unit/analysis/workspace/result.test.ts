import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { observeWorkspace } from "../../../../src/analysis/workspace/index.ts";
import { cleanupWorkspaces, link, makeWorkspace, write, writeJson } from "./helpers.ts";

afterEach(cleanupWorkspaces);

describe("observeWorkspace result contract", () => {
  it("returns useful generic facts for a source-only directory", async () => {
    const root = makeWorkspace();
    // biome-ignore lint/security/noSecrets: source fixture, not a secret
    write(root, "src/main.py", "print('hello')\n");
    write(root, "README.md", "Project notes\n");

    const result = await observeWorkspace(root);

    expect(result.inventory.entries).toEqual([
      { path: "README.md", kind: "file" },
      { path: "src/main.py", kind: "file" },
    ]);
    expect(result.projects).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.metadata.documents).toEqual([]);
    expect(result.collection.status).toBe("complete");
  });

  it("returns a deeply immutable result", async () => {
    const root = makeWorkspace();
    writeJson(root, "package.json", {
      name: "frozen",
      workspaces: ["packages/*"],
      dependencies: { target: "workspace:*" },
    });
    writeJson(root, "target/package.json", { name: "target" });

    const result = await observeWorkspace(root);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.inventory)).toBe(true);
    expect(Object.isFrozen(result.inventory.entries)).toBe(true);
    expect(Object.isFrozen(result.projects)).toBe(true);
    expect(Object.isFrozen(result.projects[0]?.dependencies)).toBe(true);
    expect(Object.isFrozen(result.metadata.issues)).toBe(true);
    expect(Reflect.set(result.inventory.entries, "0", { path: "changed", kind: "file" })).toBe(
      false,
    );
  });

  it("never reads metadata through a symbolic link", async () => {
    const external = makeWorkspace();
    const root = makeWorkspace();
    writeJson(external, "package.json", { name: "secret-package" });
    link(root, "package.json", path.join(external, "package.json"));

    const result = await observeWorkspace(root);

    expect(result.projects).toEqual([]);
    expect(result.inventory.entries).toEqual([{ path: "package.json", kind: "symlink" }]);
    expect(result.metadata.documents).toEqual([
      {
        path: "package.json",
        kind: "package-json",
        status: "skipped",
        reason: "Symbolic-link metadata is not read.",
      },
    ]);
    expect(result.metadata.issues).toEqual([
      expect.objectContaining({ path: "package.json", kind: "symlink" }),
    ]);
    expect(result.collection.status).toBe("partial");
  });
});
