/** Git inventory command boundary. This module never interprets project metadata. */

import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import type { CodeRequestControl } from "@mrclrchtr/supi-code-runtime/api";
import { errorMessage } from "./paths.ts";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Git path list outcome before filesystem classification and exclusions. */
export type GitPathResult =
  | { readonly kind: "git"; readonly paths: readonly string[] }
  | { readonly kind: "not-git" }
  | { readonly kind: "deadline" }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "missing-command"; readonly reason: string };

type GitCommandResult =
  | { readonly kind: "ok"; readonly stdout: string }
  | { readonly kind: "deadline" }
  | { readonly kind: "error"; readonly reason: string; readonly missing?: boolean };

/**
 * Read tracked and untracked paths under `root`.
 *
 * `git ls-files` runs from the requested root, so paths stay inside that root
 * even when it is a repository subdirectory. Without `--exclude-standard`,
 * ignored untracked paths stay visible for explicit focus inspection.
 */
export async function readGitPaths(
  root: string,
  includeIgnored: boolean,
  control: CodeRequestControl | undefined,
): Promise<GitPathResult> {
  const inside = await runGit(root, ["rev-parse", "--is-inside-work-tree"], control);
  if (inside.kind === "deadline") return inside;
  if (inside.kind === "error") {
    if (inside.missing) return { kind: "missing-command", reason: inside.reason };
    if (isNotRepository(inside.reason)) return { kind: "not-git" };
    return { kind: "unavailable", reason: inside.reason };
  }
  if (inside.stdout.trim() !== "true") return { kind: "not-git" };

  const args = ["ls-files", "-z", "--cached", "--others"];
  if (!includeIgnored) args.push("--exclude-standard");
  args.push("--", ".");
  const listed = await runGit(root, args, control);
  if (listed.kind === "deadline") return listed;
  if (listed.kind === "error") {
    if (isNotRepository(listed.reason)) return { kind: "not-git" };
    return { kind: "unavailable", reason: listed.reason };
  }
  return {
    kind: "git",
    paths: [...new Set(listed.stdout.split("\0").filter((path) => path.length > 0))],
  };
}

/** Check the explicit directory against Git's own ignore rules, without name heuristics. */
export async function isGitIgnoredDirectory(
  directory: string,
  control?: CodeRequestControl,
): Promise<boolean> {
  const result = await runGit(
    path.dirname(directory),
    ["check-ignore", "--no-index", "-q", "--", path.basename(directory)],
    control,
  );
  return result.kind === "ok";
}

function isNotRepository(reason: string): boolean {
  return /not a git repository|not a git work tree|not a work tree/i.test(reason);
}

async function runGit(
  root: string,
  args: readonly string[],
  control: CodeRequestControl | undefined,
): Promise<GitCommandResult> {
  control?.signal?.throwIfAborted();
  const deadline = finiteDeadline(control);
  if (deadline !== null && Date.now() >= deadline) return { kind: "deadline" };

  const controller = new AbortController();
  const forwardAbort = () => controller.abort(control?.signal?.reason);
  control?.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer =
    deadline === null
      ? null
      : setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));

  try {
    const { stdout } = await execFileAsync("git", ["-c", "core.fsmonitor=false", ...args], {
      env: {
        ...process.env,
        LC_ALL: "C",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_DIR: undefined,
        GIT_WORK_TREE: undefined,
        GIT_INDEX_FILE: undefined,
      },
      cwd: root,
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      signal: controller.signal,
    });
    if (deadline !== null && Date.now() >= deadline) return { kind: "deadline" };
    return { kind: "ok", stdout };
  } catch (error) {
    control?.signal?.throwIfAborted();
    if (deadline !== null && Date.now() >= deadline) return { kind: "deadline" };
    return {
      kind: "error",
      reason: errorMessage(error),
      missing:
        typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT",
    };
  } finally {
    if (timer) clearTimeout(timer);
    control?.signal?.removeEventListener("abort", forwardAbort);
  }
}

function finiteDeadline(control: CodeRequestControl | undefined): number | null {
  const deadline = control?.deadline;
  return typeof deadline === "number" && Number.isFinite(deadline) ? deadline : null;
}
