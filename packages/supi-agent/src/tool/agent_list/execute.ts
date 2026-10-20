import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import type { SavedDelegationConversation } from "../../delegation/checkpoints.ts";
import { readSavedDelegationConversations } from "../../delegation/checkpoints.ts";
import type { DelegationController } from "../../delegation/controller.ts";
import { agentProfileCatalogueStore } from "../../session.ts";
import { currentProfileUnavailableReason } from "../agent_run/batch-preflight.ts";
import { type AgentListRow, buildAgentListResult } from "./result.ts";
import { agentListSpec } from "./spec.ts";

type Execute = NonNullable<Parameters<ExtensionAPI["registerTool"]>[0]["execute"]>;

/** Build the public agent_list operation from raw branch history and live session state. */
export function makeAgentListExecute(controller: DelegationController): Execute {
  // biome-ignore lint/complexity/useMaxParams: Pi execute requires five parameters.
  return async (_callId, input, _signal, _onUpdate, ctx) => {
    if (!Value.Check(agentListSpec.parameters, input)) throw new Error("Invalid agent_list input.");
    const params = input as { offset?: number; limit?: number };
    const catalogue = agentProfileCatalogueStore.get();
    if (!catalogue)
      throw new Error("Agent Profile catalogue is not yet loaded. Wait for session start.");
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 20;
    const saved = readSavedDelegationConversations(ctx.sessionManager.getBranch());
    const activity = controller.conversationActivity(ctx);
    const conversations = new Map(
      saved.conversations.map((conversation) => [conversation.conversationId, conversation]),
    );
    for (const [conversationId, live] of activity) {
      if (!conversations.has(conversationId)) {
        conversations.set(conversationId, {
          conversationId,
          label: live.label,
          profileId: live.profileId,
        });
      }
    }
    const rows: AgentListRow[] = [...conversations.values()].map((conversation) =>
      buildAgentListRow(conversation, activity.get(conversation.conversationId), catalogue, ctx),
    );
    return buildAgentListResult({ rows, offset, limit });
  };
}

function buildAgentListRow(
  conversation: SavedDelegationConversation,
  live: { status: "busy" | "pending-collection" } | undefined,
  catalogue: NonNullable<ReturnType<typeof agentProfileCatalogueStore.get>>,
  ctx: Parameters<DelegationController["conversationActivity"]>[0],
): AgentListRow {
  const unavailableReason = conversationUnavailableReason(conversation, live, catalogue, ctx);
  const status = unavailableReason ? "unavailable" : (live?.status ?? "available");
  return {
    conversationId: conversation.conversationId,
    label: conversation.label ?? "(unavailable)",
    profileId: conversation.profileId ?? "(unavailable)",
    status,
    ...(unavailableReason ? { reason: unavailableReason } : {}),
    ...(live ? { activity: live.status } : {}),
  };
}

function conversationUnavailableReason(
  conversation: SavedDelegationConversation,
  live: { status: "busy" | "pending-collection" } | undefined,
  catalogue: NonNullable<ReturnType<typeof agentProfileCatalogueStore.get>>,
  ctx: Parameters<DelegationController["conversationActivity"]>[0],
): string | undefined {
  if (conversation.unavailableReason) return conversation.unavailableReason;
  if (!conversation.profileId && !live) return "Saved profile information is missing.";
  if (conversation.profileId) {
    const profileReason = currentProfileUnavailableReason(conversation.profileId, catalogue, ctx);
    if (profileReason) return profileReason;
  }
  if (!live && (!conversation.latest || !conversation.context)) {
    return "No valid saved checkpoint is available.";
  }
  return undefined;
}
