/** Gitignore-style exclusion matching for workspace observation. */

import ignore from "ignore";
import { errorMessage } from "./paths.ts";
import type { WorkspaceObservationError } from "./types.ts";

/** Compiled caller exclusions. Matching is case-sensitive and root-relative. */
export interface ExclusionMatcher {
  matches(relativePath: string, directory: boolean): boolean;
}

/** Compile caller patterns one at a time so one invalid pattern cannot erase valid exclusions. */
export function createExclusionMatcher(
  patterns: readonly string[],
  errors: WorkspaceObservationError[],
): ExclusionMatcher {
  const matcher = ignore({ ignorecase: false });
  for (const pattern of patterns) {
    try {
      matcher.add(pattern);
    } catch (error) {
      errors.push({
        stage: "inventory",
        path: null,
        reason: `Invalid exclude pattern \`${pattern}\`: ${errorMessage(error)}`,
      });
    }
  }
  return {
    matches(relativePath, directory) {
      if (relativePath === ".") return false;
      return matcher.ignores(directory ? `${relativePath}/` : relativePath);
    },
  };
}
