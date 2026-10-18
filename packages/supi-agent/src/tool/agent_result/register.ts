import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DelegationController } from "../../delegation/controller.ts";
import { toolDescription } from "./guidance.ts";
import { renderCall, renderResult } from "./render.ts";
import { agentResultSpec, makeAgentResultExecute } from "./spec.ts";

/** Bind collection metadata and rendering to the session-owned workflow. */
export function registerAgentResultTool(pi: ExtensionAPI, controller: DelegationController): void {
  pi.registerTool({
    ...agentResultSpec,
    description: toolDescription,
    renderCall,
    renderResult,
    execute: makeAgentResultExecute(controller, agentResultSpec.parameters),
  });
}
