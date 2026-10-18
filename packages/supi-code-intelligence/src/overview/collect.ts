import { statSync } from "node:fs";
import { loadAutomaticExclusionPatterns } from "@mrclrchtr/supi-core/config";
import { observeWorkspace } from "../analysis/workspace/observe.ts";
import { workspaceOrientationData } from "../session/orientation/workspace-context.ts";
import { prepareWorkspaceOutput } from "../tool/code_orientation/workspace-output.ts";

/** Capture a first-turn map without requiring any project metadata or provider. */
export async function collectOverview(cwd: string, projectTrusted: boolean, homeDir?: string) {
  try {
    if (!statSync(cwd).isDirectory()) return null;
  } catch {
    return null;
  }
  const exclude = loadAutomaticExclusionPatterns(cwd, { projectTrusted, homeDir });
  const observation = await observeWorkspace(cwd, {
    exclude,
    control: { deadline: Date.now() + 10_000 },
  });
  return prepareWorkspaceOutput(
    workspaceOrientationData({ observation, cwd, focus: null, maxResults: 10, overview: true }),
  );
}
