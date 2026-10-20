import type { ResolvedTask } from "./batch-preflight.ts";

/** Build the next child input without replaying the original task or tool actions. */
export function buildChildPrompt(task: ResolvedTask, sharedContext?: string): string {
  const sections: string[] = [];
  if (task.parentCheckpointId !== null) {
    sections.push(
      `Follow-up for "${task.conversationLabel}". Earlier findings describe a changing workspace; check current files before relying on them. Previous tool handles and process resources may have expired.`,
    );
    if (task.previousRunStatus && task.previousRunStatus !== "completed") {
      const reason = task.previousFailureCode ? ` (${task.previousFailureCode})` : "";
      sections.push(
        `The previous Agent Run ended ${task.previousRunStatus}${reason}. Earlier actions may be incomplete or uncertain. Check actual state before repeating an action. Do not replay interrupted actions.`,
      );
    }
  }
  if (sharedContext?.trim()) sections.push(sharedContext.trim());
  sections.push(task.instructions);
  return sections.join("\n\n");
}
