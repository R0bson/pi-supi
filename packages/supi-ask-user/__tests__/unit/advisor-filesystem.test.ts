import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdvisorProjectTools } from "../../src/advisor/project-tools.ts";

let directory: string;
let root: string;
let tools: AdvisorProjectTools;
let controller: AbortController;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "advisor-files-"));
  root = join(directory, "project");
  await mkdir(root);
  await writeFile(join(root, "visible.ts"), "first\nneedle\nlast");
  controller = new AbortController();
  tools = await AdvisorProjectTools.create(root, controller.signal);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function file(path: string, text = "SECRET needle") {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), text);
}

describe("advisor local filesystem tools", () => {
  it("reads bounded text and records actual read sources", async () => {
    const result = JSON.parse(await tools.execute("advisor_read", { path: "visible.ts" }));
    expect(result).toEqual({ path: "visible.ts", text: "first\nneedle\nlast", truncated: false });
    expect([...tools.readSources]).toEqual(["visible.ts"]);
    await file("large.txt", "x".repeat(40000));
    expect(JSON.parse(await tools.execute("advisor_read", { path: "large.txt" }))).toMatchObject({
      truncated: true,
    });
  });

  it("blocks traversal, absolute paths, backslashes, symlinks and hardlinks", async () => {
    await writeFile(join(directory, "outside"), "outside secret");
    await symlink(join(directory, "outside"), join(root, "escape"));
    await symlink(root, join(root, "internal"));
    await link(join(directory, "outside"), join(root, "hardlink"));
    for (const path of [
      "../outside",
      join(directory, "outside"),
      "escape",
      "internal/visible.ts",
      "hardlink",
      "..\\outside",
    ]) {
      await expect(tools.execute("advisor_read", { path })).rejects.toThrow();
    }
    expect(tools.readSources.size).toBe(0);
  });

  it("never reads ignored or typical secret files, including explicit reads and search", async () => {
    await file(".gitignore", "ignored/\n*.private\n.hidden*\n!ignored/reinclude.ts\n");
    for (const path of [
      "ignored/reinclude.ts",
      "a.private",
      ".hidden-note",
      ".env",
      ".env.local",
      "key.pem",
      ".aws/config",
      ".npmrc",
      "secrets/token.txt",
      "node_modules/dependency.ts",
    ]) {
      await file(path);
      await expect(tools.execute("advisor_read", { path })).rejects.toThrow();
    }
    const listing = await tools.execute("advisor_list", {});
    expect(listing).not.toContain("reinclude");
    expect(listing).not.toContain(".env");
    const result = JSON.parse(await tools.execute("advisor_search", { query: "needle" }));
    expect(result.matches).toEqual([{ path: "visible.ts", line: 2, text: "needle" }]);
    expect([...tools.readSources]).not.toContain(".env");
  });

  it("applies nested, ancestor and git info ignores including dotfile globs", async () => {
    await writeFile(join(directory, ".gitignore"), "project/ancestor.txt\n");
    await file("nested/.gitignore", "/local.txt\n**/*.secret\n*.txt\n");
    await file(".git/info/exclude", "info.txt\n");
    for (const path of [
      "ancestor.txt",
      "nested/local.txt",
      "nested/deep/file.secret",
      "nested/.hidden.txt",
      "info.txt",
    ]) {
      await file(path);
      await expect(tools.execute("advisor_read", { path })).rejects.toThrow();
    }
    await file("nested/okay.ts", "okay");
    expect(await tools.execute("advisor_read", { path: "nested/okay.ts" })).toContain("okay");
  });

  it("respects shared git info exclusions in worktrees", async () => {
    const common = join(directory, "common-git");
    const gitdir = join(common, "worktrees", "advisor");
    await mkdir(gitdir, { recursive: true });
    await mkdir(join(common, "info"));
    await writeFile(join(common, "info", "exclude"), "shared-private.txt\n");
    await writeFile(join(gitdir, "commondir"), "../..\n");
    await file(".git", `gitdir: ${await realpath(gitdir)}\n`);
    await file("shared-private.txt");
    await expect(tools.execute("advisor_read", { path: "shared-private.txt" })).rejects.toThrow();
    expect(await tools.execute("advisor_read", { path: "visible.ts" })).toContain("needle");
  });

  it("fails closed for unsafe ignore sources and refuses binary files and unknown tools", async () => {
    await writeFile(join(directory, "ignore"), "visible.ts");
    await symlink(join(directory, "ignore"), join(root, ".gitignore"));
    await expect(tools.execute("advisor_read", { path: "visible.ts" })).rejects.toThrow();
    await rm(join(root, ".gitignore"));
    await file("binary", "a\0b");
    await expect(tools.execute("advisor_read", { path: "binary" })).rejects.toThrow();
    await expect(tools.execute("bash", { command: "pwd" })).rejects.toThrow("Unknown");
  });

  it("honors cancellation before calls and after asynchronous reads", async () => {
    controller.abort("do not expose this reason");
    await expect(tools.execute("advisor_read", { path: "visible.ts" })).rejects.toMatchObject({
      name: "AbortError",
      message: "Advisor cancelled.",
    });
    const second = new AbortController();
    const fresh = await AdvisorProjectTools.create(root, second.signal);
    const pending = fresh.execute("advisor_read", { path: "visible.ts" });
    second.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
