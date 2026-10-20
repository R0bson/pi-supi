import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { cloneAndValidateContext } from "./context-validation.ts";
import type { AgentRunContext } from "./types.ts";

/** Copy and validate restored session data before the runtime starts setup. */
export function cloneAgentRunContext(value: AgentRunContext): AgentRunContext {
  return cloneAndValidateContext(value);
}

/** Create an in-memory Pi manager with the selected restored branch. */
export function createAgentRunSessionManager(
  cwd: string,
  context?: AgentRunContext,
): SessionManager {
  if (!context) return SessionManager.inMemory(cwd);
  const manager = SessionManager.inMemory(cwd, undefined, [...context.entries]);
  if (context.leafId === null) manager.resetLeaf();
  else manager.branch(context.leafId);
  return manager;
}

/** Capture a detached copy of the owned session's native history. */
export function captureAgentRunContext(session: AgentSession): AgentRunContext | undefined {
  try {
    return cloneAgentRunContext({
      entries: session.sessionManager.getEntries(),
      leafId: session.sessionManager.getLeafId(),
    });
  } catch {
    return undefined;
  }
}
