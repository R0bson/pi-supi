import { promises as fs, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeWorkspace } from "../../../../src/analysis/workspace/index.ts";
import { cleanupWorkspaces, initGit, makeWorkspace, write } from "./helpers.ts";

afterEach(() => {
  vi.restoreAllMocks();
  cleanupWorkspaces();
});
describe("workspace observation safety", () => {
  it("rejects cancellation during the last metadata read", async () => {
    const root = makeWorkspace();
    write(root, "package.json", JSON.stringify({ name: "last" }));
    const controller = new AbortController();
    const reason = new Error("cancelled during metadata read");
    const open = fs.open;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const file = await open(...args);
      controller.abort(reason);
      return file;
    });
    await expect(observeWorkspace(root, { control: { signal: controller.signal } })).rejects.toBe(
      reason,
    );
  });

  it("prioritizes a Git directory without bypassing configured exclusions", async () => {
    const root = makeWorkspace();
    write(root, "aaa/unrelated.txt", "");
    write(root, "selected/a-skip.txt", "");
    write(root, "selected/kept.py", "pass\n");
    initGit(root);
    const result = await observeWorkspace(root, {
      maxEntries: 1,
      prioritizeDirectory: "selected",
      exclude: ["selected/a-skip.txt"],
    });
    expect(result.inventory.entries).toEqual([{ path: "selected/kept.py", kind: "file" }]);
    expect(result.collection).toMatchObject({
      stopReason: "entry-limit",
      prioritizedDirectory: "selected",
    });
  });

  it("does not follow a Git root alias", async () => {
    const root = makeWorkspace();
    const parent = makeWorkspace();
    write(root, "package.json", JSON.stringify({ name: "outside" }));
    initGit(root);
    symlinkSync(root, join(parent, "alias"));
    const result = await observeWorkspace(join(parent, "alias"));
    expect(result.inventory.entries).toEqual([]);
    expect(result.projects).toEqual([]);
    expect(result.collection.status).toBe("partial");
  });

  it("does not read tracked paths through a replaced directory", async () => {
    const root = makeWorkspace();
    const outside = makeWorkspace();
    write(root, "unit/package.json", JSON.stringify({ name: "inside" }));
    write(outside, "package.json", JSON.stringify({ name: "outside" }));
    initGit(root);
    rmSync(join(root, "unit"), { recursive: true });
    symlinkSync(outside, join(root, "unit"));
    const result = await observeWorkspace(root);
    expect(result.projects.some((project) => project.name === "outside")).toBe(false);
    expect(result.inventory.entries.some((entry) => entry.path === "unit/package.json")).toBe(
      false,
    );
    expect(result.collection.status).toBe("partial");
  });

  it("reports an oversized metadata document without parsing it", async () => {
    const root = makeWorkspace();
    write(
      root,
      "package.json",
      JSON.stringify({ name: "large", description: "x".repeat(1_100_000) }),
    );
    const result = await observeWorkspace(root);
    expect(result.projects).toHaveLength(0);
    expect(result.metadata.issues.some((issue) => issue.reason.includes("limit"))).toBe(true);
    expect(result.collection.status).toBe("partial");
  });
});
