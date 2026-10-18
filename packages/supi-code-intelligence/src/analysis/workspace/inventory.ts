/** Bounded Git and filesystem inventory collection for workspace observation. */

import { type Dirent, promises as fs } from "node:fs";
import * as path from "node:path";
import type { CodeRequestControl } from "@mrclrchtr/supi-code-runtime/api";
import { createExclusionMatcher, type ExclusionMatcher } from "./exclusions.ts";
import { readGitPaths } from "./git.ts";
import {
  compareObservationPaths,
  errorMessage,
  isWithinRoot,
  joinRelative,
  normalizeInventoryPath,
} from "./paths.ts";
import { assertUnlinkedPath } from "./safe-path.ts";
import type {
  InventoryEntry,
  InventorySource,
  InventoryStopReason,
  WorkspaceObservationError,
} from "./types.ts";

/** Default retained-entry cap for one observation. */
export const DEFAULT_MAX_INVENTORY_ENTRIES = 10_000;

/** Internal inventory result before metadata collection. */
export interface InventoryCollectionResult {
  readonly source: InventorySource;
  readonly entries: readonly InventoryEntry[];
  readonly stopReason: InventoryStopReason;
  readonly errors: readonly WorkspaceObservationError[];
}

/** Options owned by inventory collection. */
export interface InventoryOptions {
  readonly exclude: readonly string[];
  readonly includeIgnored: boolean;
  readonly maxEntries: number;
  readonly prioritizedDirectory: string | null;
  readonly control?: CodeRequestControl;
}

/** Collect tracked plus non-ignored untracked paths, or accessible files outside Git. */
export async function collectInventory(
  root: string,
  options: InventoryOptions,
): Promise<InventoryCollectionResult> {
  options.control?.signal?.throwIfAborted();
  const errors: WorkspaceObservationError[] = [];
  const exclusions = createExclusionMatcher(options.exclude, errors);
  const maxEntries = normalizeLimit(options.maxEntries);
  if (deadlineReached(options.control)) {
    return { source: "filesystem", entries: [], stopReason: "deadline", errors };
  }

  const context: InventoryContext = {
    root,
    exclusions,
    maxEntries,
    prioritizedDirectory: options.prioritizedDirectory,
    control: options.control,
    errors,
  };
  const rootError = await inspectRoot(root);
  if (rootError)
    return {
      source: "filesystem",
      entries: [],
      stopReason: "complete",
      errors: [...errors, rootError],
    };
  const git = await readGitPaths(root, options.includeIgnored, options.control);
  if (git.kind === "git") return classifyGitPaths(context, git.paths);
  if (git.kind === "deadline") {
    return { source: "git", entries: [], stopReason: "deadline", errors };
  }
  if (git.kind === "unavailable") {
    errors.push({
      stage: "inventory",
      path: null,
      reason: `Git inventory unavailable: ${git.reason}`,
    });
    return { source: "git", entries: [], stopReason: "complete", errors };
  }
  if (git.kind === "missing-command")
    errors.push({
      stage: "inventory",
      path: null,
      reason: "Git is unavailable; filesystem inventory cannot apply Git ignore rules.",
    });
  return collectFilesystem(context);
}

interface InventoryContext {
  readonly root: string;
  readonly exclusions: ExclusionMatcher;
  readonly maxEntries: number;
  readonly prioritizedDirectory: string | null;
  readonly control: CodeRequestControl | undefined;
  readonly errors: WorkspaceObservationError[];
}

async function classifyGitPaths(
  context: InventoryContext,
  paths: readonly string[],
): Promise<InventoryCollectionResult> {
  const entries: InventoryEntry[] = [];
  let stopReason: InventoryStopReason = "complete";
  for (const rawPath of [...paths].sort((left, right) =>
    compareObservationPaths(left, right, context.prioritizedDirectory),
  )) {
    context.control?.signal?.throwIfAborted();
    if (deadlineReached(context.control)) {
      stopReason = "deadline";
      break;
    }
    const relativePath = normalizeInventoryPath(context.root, rawPath);
    if (!relativePath) {
      context.errors.push({
        stage: "inventory",
        path: rawPath,
        reason: "Git returned a path outside the requested root.",
      });
      continue;
    }
    if (context.exclusions.matches(relativePath, false)) continue;
    const entry = await classifyGitEntry(context, relativePath);
    if (!entry) continue;
    if (entries.length >= context.maxEntries) {
      stopReason = "entry-limit";
      break;
    }
    entries.push(entry);
  }
  return { source: "git", entries: sortEntries(entries), stopReason, errors: context.errors };
}

async function classifyGitEntry(
  context: InventoryContext,
  relativePath: string,
): Promise<InventoryEntry | null> {
  const absolutePath = path.join(context.root, ...relativePath.split("/"));
  if (!isWithinRoot(context.root, absolutePath)) return null;
  try {
    await assertUnlinkedPath(context.root, relativePath);
    const stats = await fs.lstat(absolutePath);
    if (stats.isSymbolicLink()) return { path: relativePath, kind: "symlink" };
    if (stats.isFile()) return { path: relativePath, kind: "file" };
    context.errors.push({
      stage: "inventory",
      path: relativePath,
      reason: "Git entry is not a regular file or symbolic link.",
    });
    return null;
  } catch (error) {
    context.errors.push({
      stage: "inventory",
      path: relativePath,
      reason: `Could not inspect Git entry: ${errorMessage(error)}`,
    });
    return null;
  }
}

async function collectFilesystem(context: InventoryContext): Promise<InventoryCollectionResult> {
  const rootCheck = await inspectRoot(context.root);
  if (rootCheck) {
    return {
      source: "filesystem",
      entries: [],
      stopReason: "complete",
      errors: [rootCheck, ...context.errors],
    };
  }

  const entries: InventoryEntry[] = [];
  const pending: string[] = ["."];
  const priority = context.prioritizedDirectory;
  if (priority && !context.exclusions.matches(priority, true)) pending.push(priority);
  const visited = new Set<string>();
  let stopReason: InventoryStopReason = "complete";
  while (pending.length > 0) {
    context.control?.signal?.throwIfAborted();
    if (deadlineReached(context.control)) {
      stopReason = "deadline";
      break;
    }
    const directory = pending.pop() ?? ".";
    if (visited.has(directory)) continue;
    visited.add(directory);
    let children: Dirent[];
    try {
      await assertUnlinkedPath(context.root, directory, true);
      children = await fs.readdir(resolveRelative(context.root, directory), {
        withFileTypes: true,
      });
    } catch (error) {
      context.errors.push({
        stage: "inventory",
        path: directory,
        reason: `Could not read directory: ${errorMessage(error)}`,
      });
      continue;
    }
    const visit = await visitChildren(context, directory, children, entries);
    pending.push(...visit.directories.reverse());
    if (visit.stopReason !== "complete") {
      stopReason = visit.stopReason;
      break;
    }
  }
  return {
    source: "filesystem",
    entries: sortEntries(entries),
    stopReason,
    errors: context.errors,
  };
}

interface ChildVisitResult {
  readonly directories: string[];
  readonly stopReason: InventoryStopReason;
}

async function visitChildren(
  context: InventoryContext,
  directory: string,
  children: readonly Dirent[],
  entries: InventoryEntry[],
): Promise<ChildVisitResult> {
  const directories: string[] = [];
  for (const child of [...children].sort((left, right) => left.name.localeCompare(right.name))) {
    context.control?.signal?.throwIfAborted();
    if (deadlineReached(context.control)) return { directories, stopReason: "deadline" };
    const relativePath = joinRelative(directory, child.name);
    if (child.isDirectory()) {
      if (!context.exclusions.matches(relativePath, true)) directories.push(relativePath);
      continue;
    }
    if (context.exclusions.matches(relativePath, false)) continue;
    const kind = await classifyDirent(context, relativePath, child);
    if (!kind) continue;
    if (entries.length >= context.maxEntries) return { directories, stopReason: "entry-limit" };
    entries.push({ path: relativePath, kind });
  }
  return { directories, stopReason: "complete" };
}

async function classifyDirent(
  context: InventoryContext,
  relativePath: string,
  child: Dirent,
): Promise<InventoryEntry["kind"] | null> {
  if (child.isSymbolicLink()) return "symlink";
  if (child.isFile()) return "file";
  try {
    const stats = await fs.lstat(resolveRelative(context.root, relativePath));
    if (stats.isSymbolicLink()) return "symlink";
    if (stats.isFile()) return "file";
  } catch (error) {
    context.errors.push({
      stage: "inventory",
      path: relativePath,
      reason: `Could not inspect entry: ${errorMessage(error)}`,
    });
    return null;
  }
  context.errors.push({
    stage: "inventory",
    path: relativePath,
    reason: "Entry is not a regular file or symbolic link.",
  });
  return null;
}

async function inspectRoot(root: string): Promise<WorkspaceObservationError | null> {
  try {
    const stats = await fs.lstat(root);
    if (stats.isSymbolicLink()) {
      return {
        stage: "inventory",
        path: ".",
        reason: "The observation root is a symbolic link; it is not followed.",
      };
    }
    if (!stats.isDirectory()) {
      return { stage: "inventory", path: ".", reason: "The observation root is not a directory." };
    }
    return null;
  } catch (error) {
    return {
      stage: "inventory",
      path: ".",
      reason: `Could not inspect the observation root: ${errorMessage(error)}`,
    };
  }
}

function resolveRelative(root: string, relativePath: string): string {
  if (relativePath === ".") return root;
  return path.join(root, ...relativePath.split("/"));
}

function normalizeLimit(value: number): number {
  if (!Number.isFinite(value)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.floor(value));
}

function deadlineReached(control: CodeRequestControl | undefined): boolean {
  const deadline = control?.deadline;
  return typeof deadline === "number" && Number.isFinite(deadline) && Date.now() >= deadline;
}

function sortEntries(entries: readonly InventoryEntry[]): InventoryEntry[] {
  return [...entries].sort((left, right) => left.path.localeCompare(right.path));
}
