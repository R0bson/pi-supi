/** Path helpers shared by workspace observation collection. */

import * as path from "node:path";

/** Convert an absolute path inside `root` into a root-relative POSIX path. */
export function relativeToRoot(root: string, absolutePath: string): string {
  const relative = path.relative(root, absolutePath);
  return relative === "" ? "." : relative.split(path.sep).join("/");
}

/** Return true when `candidate` is inside `root` or equal to it. */
export function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/** Validate and normalize a path that came from an external inventory command. */
export function normalizeInventoryPath(root: string, rawPath: string): string | null {
  const normalized = rawPath.replaceAll(path.sep, "/");
  if (!normalized || normalized.startsWith("/") || normalized.endsWith("/")) return null;
  if (normalized.split("/").some((segment) => segment === "" || segment === "..")) return null;
  const absolute = path.resolve(root, ...normalized.split("/"));
  return isWithinRoot(root, absolute) ? relativeToRoot(root, absolute) : null;
}

/** Return the root-relative directory of a root-relative file path. */
export function relativeDirectory(relativePath: string): string {
  const directory = path.posix.dirname(relativePath);
  return directory === "" ? "." : directory;
}

/** Join a root-relative base and child path with POSIX separators. */
export function joinRelative(base: string, child: string): string {
  if (base === "." || base === "") return child;
  return `${base}/${child}`;
}

/** Normalize one caller path to a root-relative POSIX spelling. */
export function normalizeRelativePath(value: string): string | null {
  const normalized = value.replaceAll(path.sep, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!normalized) return ".";
  if (normalized.startsWith("/") || normalized.split("/").some((segment) => segment === "..")) {
    return null;
  }
  return normalized;
}

/** Keep an explicit subtree ahead of unrelated paths, then use the normal path order. */
export function compareObservationPaths(
  left: string,
  right: string,
  priority: string | null,
): number {
  const rank = (value: string) =>
    priority && (value === priority || value.startsWith(`${priority}/`)) ? 0 : 1;
  return rank(left) - rank(right) || left.localeCompare(right);
}

/** Read an unknown error as a stable message. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
