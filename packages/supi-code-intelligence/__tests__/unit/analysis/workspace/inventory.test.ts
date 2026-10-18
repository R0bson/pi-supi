import { symlinkSync } from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { observeWorkspace } from "../../../../src/analysis/workspace/index.ts";
import { cleanupWorkspaces, initGit, link, makeWorkspace, write } from "./helpers.ts";

afterEach(cleanupWorkspaces);

function paths(result: Awaited<ReturnType<typeof observeWorkspace>>): string[] {
  return result.inventory.entries.map((entry) => entry.path);
}

describe("observeWorkspace inventory", () => {
  it("collects every accessible non-Git file without name-based directory omission", async () => {
    const root = makeWorkspace();
    const external = makeWorkspace();
    write(root, "src/source.ts");
    write(root, "dist/output.js");
    write(root, "node_modules/pkg/index.js");
    write(root, "vendor/library.c");
    write(root, "cache/data.bin");
    write(root, "src/.hidden");
    write(external, "secret.ts");
    link(root, "alias.ts", path.join(external, "secret.ts"));
    link(root, "linked-directory", external);

    const result = await observeWorkspace(root);

    expect(result.root).toBe(path.resolve(root));
    expect(result.inventory.source).toBe("filesystem");
    expect(paths(result)).toEqual([
      "alias.ts",
      "cache/data.bin",
      "dist/output.js",
      "linked-directory",
      "node_modules/pkg/index.js",
      "src/.hidden",
      "src/source.ts",
      "vendor/library.c",
    ]);
    expect(result.inventory.entries).toContainEqual({ path: "alias.ts", kind: "symlink" });
    expect(result.inventory.entries).toContainEqual({ path: "linked-directory", kind: "symlink" });
    expect(paths(result)).not.toContain("linked-directory/secret.ts");
    expect(result.inclusion).toMatchObject({
      source: "filesystem",
      exclude: [],
      includeIgnored: false,
      symlinks: "not-followed",
      directoryNamesExcluded: false,
    });
    expect(result.collection).toMatchObject({
      status: "complete",
      stopReason: "complete",
      limits: { maxEntries: 10_000, deadline: null },
    });
  });

  it("applies caller exclusions without removing other familiar directory names", async () => {
    const root = makeWorkspace();
    write(root, "src/source.ts");
    write(root, "src/debug.log");
    write(root, "dist/output.js");
    write(root, "node_modules/pkg/index.js");

    const result = await observeWorkspace(root, { exclude: ["dist/", "*.log"] });

    expect(paths(result)).toEqual(["node_modules/pkg/index.js", "src/source.ts"]);
    expect(result.inclusion.exclude).toEqual(["dist/", "*.log"]);
    expect(result.collection.status).toBe("complete");
  });

  it("stops at the entry limit and reports the bound honestly", async () => {
    const root = makeWorkspace();
    write(root, "a.txt");
    write(root, "b.txt");
    write(root, "c.txt");

    const result = await observeWorkspace(root, { maxEntries: 2 });

    expect(paths(result)).toEqual(["a.txt", "b.txt"]);
    expect(result.collection).toMatchObject({
      status: "partial",
      stopReason: "entry-limit",
      limits: { maxEntries: 2 },
    });
  });

  it("returns a partial observation for an expired deadline and rejects cancellation", async () => {
    const root = makeWorkspace();
    write(root, "source.ts");
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));

    const expired = await observeWorkspace(root, {
      control: { deadline: Date.now() - 1 },
    });
    await expect(
      observeWorkspace(root, { control: { signal: controller.signal } }),
    ).rejects.toThrow("cancelled");

    expect(expired.inventory.entries).toEqual([]);
    expect(expired.collection).toMatchObject({ status: "partial", stopReason: "deadline" });
    expect(expired.collection.limits.deadline).toBeLessThan(Date.now());
  });

  it("rejects a symbolic-link root without following it", async () => {
    const parent = makeWorkspace();
    const root = makeWorkspace();
    write(root, "inside.ts");
    const alias = path.join(parent, "alias");
    symlinkSync(root, alias);

    const result = await observeWorkspace(alias);

    expect(result.root).toBe(path.resolve(alias));
    expect(result.inventory.entries).toEqual([]);
    expect(result.collection.status).toBe("partial");
    expect(result.collection.errors).toContainEqual(
      expect.objectContaining({ path: ".", reason: expect.stringContaining("symbolic link") }),
    );
  });

  it("uses Git tracked plus non-ignored untracked files and deduplicates paths", async () => {
    const root = makeWorkspace();
    write(root, ".gitignore", "ignored/\n");
    write(root, "src/tracked.ts");
    write(root, "notes.md");
    initGit(root);
    write(root, "src/untracked.ts");
    write(root, "ignored/secret.ts");
    write(root, "build/output.js");

    const result = await observeWorkspace(root);

    expect(result.inventory.source).toBe("git");
    expect(paths(result)).toEqual([
      ".gitignore",
      "build/output.js",
      "notes.md",
      "src/tracked.ts",
      "src/untracked.ts",
    ]);
    expect(paths(result).filter((entry) => entry === "src/tracked.ts")).toHaveLength(1);
    expect(paths(result)).not.toContain("ignored/secret.ts");
  });

  it("restricts Git paths to a requested subdirectory root", async () => {
    const repository = makeWorkspace();
    write(repository, "root.ts");
    write(repository, "packages/app/index.ts");
    write(repository, "packages/other/index.ts");
    initGit(repository);

    const result = await observeWorkspace(path.join(repository, "packages/app"));

    expect(result.root).toBe(path.resolve(repository, "packages/app"));
    expect(result.inventory.source).toBe("git");
    expect(paths(result)).toEqual(["index.ts"]);
  });

  it("includes Git-ignored paths only when an explicit focus requests them", async () => {
    const repository = makeWorkspace();
    write(repository, ".gitignore", "ignored/\n");
    write(repository, "ignored/secret.ts");
    initGit(repository);
    const focus = path.join(repository, "ignored");

    const defaultResult = await observeWorkspace(focus);
    const included = await observeWorkspace(focus, { includeIgnored: true });

    expect(defaultResult.inventory.entries).toEqual([]);
    expect(paths(included)).toEqual(["secret.ts"]);
    expect(included.inclusion.includeIgnored).toBe(true);
  });
});
