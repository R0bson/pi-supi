import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DelegationController } from "../../delegation/controller.ts";
import { makeAgentListExecute } from "./execute.ts";
import { toolDescription } from "./guidance.ts";
import { renderCall, renderResult } from "./render.ts";
import { agentListSpec } from "./spec.ts";

/** Register the saved Agent Conversation listing tool. */
export function registerAgentListTool(pi: ExtensionAPI, controller: DelegationController): void {
  pi.registerTool({
    ...agentListSpec,
    description: toolDescription,
    renderCall,
    renderResult,
    execute: makeAgentListExecute(controller),
  });
}
