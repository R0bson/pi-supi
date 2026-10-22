// Prompt guidance and tool description for the redesigned ask_user tool.

export const toolDescription =
  "Open a blocking interactive TUI form for related user decisions that block progress. Complete available investigation first; ask about authorization or trade-offs, not whether to perform routine verification. Not for status updates or broad surveys. Make the form self-contained: assume domain knowledge, not familiarity with the problem, code, investigation, or proposed solution. Supports choice/text questions, one active form, and sequential execution; requires TUI custom UI.";

export const promptSnippet = "collect related blocking user decisions in one form";

export const promptGuidelines = [
  "Group related questions into one ask_user call, not one compound question. Use separate questions when answers can differ by item; avoid bundled option combinations or deferring already-known choices to another form.",
  "Avoid sibling tool calls that depend on the ask_user answer.",
  "In ask_user, use stable ids/values; recommendations must match question type, and unanswered questions return `needs_discussion`.",
  "In ask_user, explain shared background in intro and each specific problem in its question prompt: current behavior, why it matters, relevant findings and uncertainty, and the decision needed. Do not rely on prior chat or tool output; explain code references in plain language without teaching domain basics.",
  "In ask_user, explain what each option changes, its consequences and trade-offs, and why the recommended option fits. Put essential context in intro/prompt or option descriptions; reserve option.details for supporting explanation, examples, or code snippets, not facts needed to understand the question.",
];

/** Package defaults for the ask_user prompt surface (used by the config resolver). */
export const ASK_USER_PROMPT_SURFACE_DEFAULTS = {
  description: toolDescription,
  promptSnippet,
  promptGuidelines: [...promptGuidelines],
};
