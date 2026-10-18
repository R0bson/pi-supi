import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

/** Report a stop request without claiming that disposal has finished. */
export function buildCancelResult(batchId: string, requested: boolean): AgentToolResult<unknown> {
  return {
    content: [
      {
        type: "text",
        text: requested
          ? `Stop requested for batch ${batchId}. Cleanup can still be active. Collect terminal results and Usage with agent_result.`
          : `Batch ${batchId} is already terminal. Collect its results and Usage with agent_result.`,
      },
    ],
    details: { batchId, requested },
  };
}
