import { stripVTControlCharacters } from "node:util";
import type { AdvisorRecommendation } from "../advisor/types.ts";
import type { FormAdvisorState } from "../session/advisor.ts";
import type { AskUserController } from "../session/controller.ts";
import type { NormalizedQuestion } from "../types.ts";
import type { RenderFormFrameArgs } from "./form-render.ts";
import { pushWrappedWithPrefix } from "./form-render-primitives.ts";

/** Remove terminal control sequences from untrusted advisor output before display or adoption. */
export function advisorText(text: string): string {
  return [...stripVTControlCharacters(text)]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return char === "\n" || char === "\t" || (code >= 32 && (code < 127 || code > 159));
    })
    .join("");
}

/** A suggestion's label is independent of the currently focused option. */
export function advisorSuggestion(
  question: NormalizedQuestion,
  advice: AdvisorRecommendation,
): string {
  if (advice.kind === "alternative") return `Outside the options: ${advisorText(advice.text)}`;
  if (advice.kind === "text") return advisorText(advice.text);
  if (question.type !== "choice") return "Unavailable";
  return advice.values
    .map((value) => question.options.find((o) => o.value === value)?.label ?? value)
    .join("; ");
}

/** Comparing advice never mutates user answers or infers acceptance from merely viewing it. */
export function matchesAdvisorAnswer(
  controller: AskUserController,
  advice: AdvisorRecommendation,
): boolean {
  if (advice.kind === "alternative") return false;
  if (advice.kind === "text")
    return controller.getTextAnswer(advice.questionId) === advisorText(advice.text).trim();
  const question = controller.questionnaire.questions.find((q) => q.id === advice.questionId);
  return (
    question?.type === "choice" &&
    !controller.isQuestionMarkedUnanswered(question.id) &&
    question.options.every(
      (o) => controller.isOptionSelected(question.id, o.value) === advice.values.includes(o.value),
    )
  );
}

/** Compact persistent header status remains visible even when the advice section is offscreen. */
export function advisorStatus(state: FormAdvisorState): string {
  if (state.status === "working") {
    const elapsed = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
    const spinner = ["◐", "◓", "◑", "◒"][Math.floor(Date.now() / 500) % 4];
    return `${spinner} Advisor: ${state.report ? "refreshing" : "working"} · ${elapsed}s`;
  }
  if (state.status === "error") return "Advisor: unavailable";
  const missing = state.report?.missingQuestionIds.length ?? 0;
  return missing ? `Advisor: ready · ${missing} unavailable` : "Advisor: ready";
}

/** Render one atomic report; editors deliberately do not include advisor shortcuts or content. */
export function renderAdvisorSection(args: RenderFormFrameArgs): string[] {
  const state = args.advisor;
  if (!state) return [];
  const lines = ["", args.theme.fg("borderMuted", "─".repeat(args.width))];
  const append = (text: string) =>
    pushWrappedWithPrefix({ lines, prefix: "", text, width: args.width });
  append(args.theme.fg("accent", advisorStatus(state)));
  lines.push("");
  renderNotice(state, append);
  if (args.mode === "review") {
    append("Open a question to inspect or apply its advice. Alt+I details · Alt+R refresh/retry");
  } else {
    const question = args.controller.currentQuestion;
    const advice = state.report?.recommendations.find((item) => item.questionId === question.id);
    if (advice) renderAdvice(args, state, advice, append);
    else if (state.status === "ready")
      append("No valid advice for this question. You can answer it or retry the analysis.");
    if (!advice) append("Alt+I details · Alt+R refresh/retry");
  }
  if (state.expanded && state.report) {
    const profile = state.report.profile;
    lines.push("");
    append(
      args.theme.fg(
        "dim",
        advisorText(
          `Model: ${profile.provider}/${profile.model} · Reasoning: ${profile.reasoning}`,
        ),
      ),
    );
  }
  return lines;
}

function renderNotice(state: FormAdvisorState, append: (text: string) => void): void {
  if (state.status === "working")
    append(
      "You can keep answering. All suggestions will appear together when the analysis finishes.",
    );
  if (state.status === "error") {
    append(state.error ?? "Advice unavailable.");
    append("Your answers are unchanged. Continue without advice or press Alt+R to retry.");
  }
  if (state.status !== "ready" && state.report)
    append("Previous advice below refers to an earlier snapshot; applying it is disabled.");
}

function renderReasoning(
  state: FormAdvisorState,
  advice: AdvisorRecommendation,
  append: (text: string) => void,
): void {
  const preview = (text: string) => {
    const clean = advisorText(text);
    return !state.expanded && clean.length > 240
      ? `${clean.slice(0, 240)}… (Alt+I details)`
      : clean;
  };
  append(`Why: ${preview(advice.rationale)}`);
  if (advice.questionComment) append(`On the question: ${preview(advice.questionComment)}`);
  if (!state.expanded) return;
  if (advice.details) append(`Details: ${advisorText(advice.details)}`);
  if (advice.evidence?.length)
    append(`Files read: ${advice.evidence.map((source) => advisorText(source.path)).join(", ")}`);
}

function currentAnswer(args: RenderFormFrameArgs): string {
  const response = args.controller
    .outcome()
    .responses.find((r) => r.questionId === args.controller.currentQuestion.id);
  if (!response) return "unanswered";
  if (response.answer.kind === "text") return response.answer.value || "unanswered";
  return (
    response.answer.options
      .filter((o) => o.selected)
      .map((o) => o.label)
      .join("; ") || "unanswered"
  );
}

function renderAdvice(
  args: RenderFormFrameArgs,
  state: FormAdvisorState,
  advice: AdvisorRecommendation,
  append: (text: string) => void,
): void {
  const question = args.controller.currentQuestion;
  append(`Suggests: ${advisorSuggestion(question, advice)}`);
  renderReasoning(state, advice, append);
  if (state.status !== "ready") {
    append("Alt+I details · Alt+R refresh/retry");
    return;
  }
  const matches = matchesAdvisorAnswer(args.controller, advice);
  if (matches) append(args.theme.fg("success", "Matches your current answer."));
  else if (advice.kind !== "alternative") append(`Your answer: ${currentAnswer(args)}`);
  const action =
    advice.kind === "alternative"
      ? "Alt+A open proposal in comment · "
      : matches
        ? ""
        : "Alt+A apply suggestion · ";
  append(`${action}Alt+I ${state.expanded ? "less" : "details"} · Alt+R refresh`);
}
