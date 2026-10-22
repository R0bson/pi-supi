import type { AdvisorReport } from "../../src/advisor/types.ts";
import type { NormalizedQuestionnaire } from "../../src/types.ts";

export const advisorForm: NormalizedQuestionnaire = {
  title: "Decision",
  questions: [
    {
      id: "choice",
      header: "Choice",
      prompt: "Pick a path",
      type: "choice",
      multi: false,
      recommendedIndexes: [0],
      options: [
        { value: "a", label: "First", details: "First option details" },
        { value: "b", label: "Second", details: "Second option details" },
      ],
    },
    { id: "text", header: "Text", prompt: "Describe it", type: "text", recommendation: "Original" },
  ],
};

export function advisorReport(): AdvisorReport {
  return {
    profile: { provider: "openai", model: "gpt-6.1-sol", reasoning: "medium" },
    recommendations: [
      {
        questionId: "choice",
        kind: "choice",
        values: ["b"],
        rationale: "Small reversible step",
        questionComment: "Do not expand scope",
        details: "Expanded explanation",
      },
      {
        questionId: "text",
        kind: "text",
        text: "Suggested answer",
        rationale: "Concrete next step",
      },
    ],
    missingQuestionIds: [],
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export async function settleAdvisor(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
