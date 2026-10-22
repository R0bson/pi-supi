import type { NormalizedQuestion, NormalizedQuestionnaire } from "../types.ts";
import type { AdvisorProfile, AdvisorRecommendation, AdvisorReport } from "./types.ts";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 16000;
}

function validMetadata(value: Record<string, unknown>, readSources: ReadonlySet<string>): boolean {
  if (!text(value.rationale)) return false;
  for (const key of ["questionComment", "details"]) {
    if (value[key] !== undefined && !text(value[key])) return false;
  }
  if (
    value.evidence !== undefined &&
    (!Array.isArray(value.evidence) ||
      value.evidence.length > 100 ||
      !value.evidence.every(
        (source) =>
          record(source) && typeof source.path === "string" && readSources.has(source.path),
      ))
  )
    return false;
  return true;
}

function validateRecord(
  value: Record<string, unknown>,
  question: NormalizedQuestion,
  readSources: ReadonlySet<string>,
): AdvisorRecommendation | undefined {
  if (!validMetadata(value, readSources)) return;
  const base = {
    questionId: question.id,
    rationale: value.rationale as string,
    ...(value.questionComment === undefined
      ? {}
      : { questionComment: value.questionComment as string }),
    ...(value.details === undefined ? {} : { details: value.details as string }),
    ...(value.evidence === undefined
      ? {}
      : {
          evidence: (value.evidence as Array<{ path: string }>).map(({ path }) => ({ path })),
        }),
  };
  if (value.kind === "alternative" && text(value.text)) {
    return { ...base, kind: "alternative", text: value.text };
  }
  if (value.kind === "text" && question.type === "text" && text(value.text)) {
    return { ...base, kind: "text", text: value.text };
  }
  if (value.kind !== "choice" || question.type !== "choice" || !Array.isArray(value.values)) return;
  const values = value.values;
  if (
    values.length < 1 ||
    (!question.multi && values.length !== 1) ||
    new Set(values).size !== values.length ||
    !values.every(
      (id) => typeof id === "string" && question.options.some((option) => option.value === id),
    )
  )
    return;
  return { ...base, kind: "choice", values: [...values] };
}

function uniqueRecord(item: unknown, count: number | undefined): item is Record<string, unknown> {
  return count === 1 && record(item);
}

/** Parse one final JSON message. Duplicate IDs invalidate all records for that ID. */
export function validateAdvisorReport(
  json: string,
  questionnaire: NormalizedQuestionnaire,
  profile: AdvisorProfile,
  readSources: ReadonlySet<string> = new Set(),
): AdvisorReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // biome-ignore lint/style/useErrorCause: parser errors may contain untrusted model text.
    throw new Error("Advisor returned invalid JSON.");
  }
  if (
    !record(parsed) ||
    !Array.isArray(parsed.recommendations) ||
    parsed.recommendations.length > 100
  ) {
    throw new Error("Advisor returned an invalid report.");
  }
  const counts = new Map<string, number>();
  for (const item of parsed.recommendations) {
    if (record(item) && typeof item.questionId === "string") {
      counts.set(item.questionId, (counts.get(item.questionId) ?? 0) + 1);
    }
  }
  const recommendations: AdvisorRecommendation[] = [];
  for (const question of questionnaire.questions) {
    const item = parsed.recommendations.find(
      (candidate) => record(candidate) && candidate.questionId === question.id,
    );
    if (!uniqueRecord(item, counts.get(question.id))) continue;
    const recommendation = validateRecord(item, question, readSources);
    if (recommendation) recommendations.push(recommendation);
  }
  if (!recommendations.length) throw new Error("Advisor returned no valid recommendations.");
  return {
    profile: { ...profile },
    recommendations,
    missingQuestionIds: questionnaire.questions
      .filter((q) => !recommendations.some((r) => r.questionId === q.id))
      .map((q) => q.id),
  };
}
