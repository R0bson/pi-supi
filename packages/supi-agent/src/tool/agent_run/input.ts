/** Explain selector errors before schema validation without changing the input. */
export function prepareAgentRunArguments(input: unknown): unknown {
  if (!input || typeof input !== "object" || !("tasks" in input) || !Array.isArray(input.tasks)) {
    return input;
  }
  const tasks: readonly unknown[] = input.tasks;
  for (const [index, task] of tasks.entries()) {
    if (!task || typeof task !== "object" || Array.isArray(task)) continue;
    // Pi removes null optional fields before schema validation. Keep that behavior.
    const hasNew = "new" in task && task.new != null;
    const hasContinue = "continue" in task && task.continue != null;
    if (hasNew === hasContinue) {
      throw new Error(
        `Invalid agent_run task at tasks[${index}]. Choose exactly one of new or continue.`,
      );
    }
  }
  return input;
}
