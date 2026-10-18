import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DelegationController } from "../../delegation/controller.ts";
import { makeAgentRunExecute } from "./execute.ts";
import { toolDescription } from "./guidance.ts";
import { renderCall, renderResult } from "./render.ts";
import { agentRunSpec, buildAgentRunParameters } from "./spec.ts";

/** Register profile-based delegation on a Pi extension. */
export function registerAgentRunTool(pi: ExtensionAPI, controller: DelegationController): void {
  const parameters = buildAgentRunParameters();
  pi.registerTool({
    ...agentRunSpec,
    description: toolDescription,
    parameters,
    renderCall,
    renderResult,
    execute: makeAgentRunExecute(controller, parameters),
  });
}
