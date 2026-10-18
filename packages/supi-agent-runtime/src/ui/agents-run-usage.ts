import type { AgentRunDisplayDetails } from "../session/agent-run-registry-types.ts";
import type { AgentsOverlayRun } from "./agents-overlay-data.ts";

/** Caller-owned background Usage collection state shown by the viewer. */
export type AgentRunUsageStatus = NonNullable<AgentRunDisplayDetails["usageStatus"]>;

/** Return the caller-owned Usage state, preferring the settled result. */
export function getRunUsageStatus(
  run: AgentsOverlayRun | undefined,
): AgentRunUsageStatus | undefined {
  return run?.result?.display?.usageStatus ?? run?.display?.usageStatus;
}

/** Format the Usage state for compact viewer output. */
export function formatRunUsageStatus(run: AgentsOverlayRun | undefined): string | undefined {
  const status = getRunUsageStatus(run);
  if (status === "uncollected") return "Usage uncollected · not included in parent totals";
  if (status === "reported") return "Usage reported";
  return undefined;
}
