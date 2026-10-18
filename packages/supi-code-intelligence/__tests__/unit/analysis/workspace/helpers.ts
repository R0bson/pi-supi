/** Real temporary-directory helpers for workspace observation tests. */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const temporaryDirectories: string[] = [];

/** Create one real temporary directory that cleanup removes. */
export function makeWorkspace(prefix = "workspace-observation-"): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(root);
  return root;
}

/** Write one file and create its parent directories. */
export function write(root: string, relativePath: string, content = "content\n"): string {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

/** Write one JSON file. */
export function writeJson(root: string, relativePath: string, value: unknown): string {
  return write(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

/** Create one symbolic link. */
export function link(root: string, relativePath: string, target: string): void {
  const linkPath = path.join(root, relativePath);
  mkdirSync(path.dirname(linkPath), { recursive: true });
  symlinkSync(target, linkPath);
}

/** Initialize a Git repository and stage all current files. */
export function initGit(root: string): void {
  git(root, ["init", "-q"]);
  git(root, ["add", "-A"]);
}

/** Run one Git command in a test directory. */
export function git(root: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: root, encoding: "utf8" }).trim();
}

/** Remove every temporary directory created by this module. */
export function cleanupWorkspaces(): void {
  for (const root of temporaryDirectories.splice(0)) rmSync(root, { recursive: true, force: true });
}
