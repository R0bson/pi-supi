import { promises as fs } from "node:fs";
import * as path from "node:path";

/** Reject link traversal below the selected root, including a replaced root itself. */
export async function assertUnlinkedPath(
  root: string,
  relativePath: string,
  includeLeaf = false,
): Promise<void> {
  const parts = relativePath.split("/").filter((part) => part !== "." && part.length > 0);
  if (!includeLeaf) parts.pop();
  let current = root;
  if ((await fs.lstat(current)).isSymbolicLink())
    throw new Error("Symbolic-link root is not followed.");
  for (const part of parts) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink())
      throw new Error(`Symbolic-link ancestor is not followed: ${relativePath}`);
  }
}
