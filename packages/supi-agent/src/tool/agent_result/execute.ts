import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import type { DelegationController } from "../../delegation/controller.ts";
import { buildCollectedResult } from "./result.ts";

type Execute = NonNullable<Parameters<ExtensionAPI["registerTool"]>[0]["execute"]>;

/** Own collection ordering: wait, revalidate, assemble output, then reserve its Usage. */
export function makeAgentResultExecute(
  controller: DelegationController,
  parameters: TSchema,
): Execute {
  // biome-ignore lint/complexity/useMaxParams: Pi execute requires five parameters.
  return async (callId, input, signal, onUpdate, ctx) => {
    if (!Value.Check(parameters, input)) throw new Error("Invalid agent_result input.");
    const params = input as { batchId: string; wait?: boolean };
    const batch = controller.get(params.batchId, ctx);
    if (params.wait) {
      onUpdate?.({
        content: [{ type: "text", text: "Waiting for Agent Run results…" }],
        details: { batchId: params.batchId },
      });
      await controller.wait(batch, signal ?? ctx.signal);
    }
    if ((signal ?? ctx.signal)?.aborted) throw new Error("Delegation collection canceled.");
    controller.get(params.batchId, ctx);
    const checkpointTasks = controller.prepareCheckpointTasks(callId, batch, ctx);
    const result = buildCollectedResult(
      batch.handle,
      checkpointTasks,
      controller.isCollected(batch, ctx),
    );
    if (typeof result.details.fullOutputPath === "string")
      controller.retainOutput(result.details.fullOutputPath);
    const receipt = controller.receipts.prepare(
      callId,
      params.batchId,
      batch.handle.snapshot().results,
    );
    return {
      ...result,
      usage: receipt.usage,
      details: { ...result.details, usageReceipt: receipt.usageReceipt },
    };
  };
}
