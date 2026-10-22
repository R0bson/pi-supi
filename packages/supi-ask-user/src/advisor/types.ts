import type { AskUserOutcome, NormalizedQuestionnaire } from "../types.ts";

/** Independent, fixed advisor routing identity; never follows the active agent model. */
export interface AdvisorProfile {
  provider: string;
  model: string;
  reasoning: "minimal" | "low" | "medium" | "high" | "xhigh";
}

/** A project file actually read during this run (project-relative path). */
export interface AdvisorEvidence {
  path: string;
}

interface RecommendationBase {
  questionId: string;
  rationale: string;
  questionComment?: string;
  details?: string;
  evidence?: AdvisorEvidence[];
}

/** Recommendations are advice, not user answers or mutations of form state. */
export type AdvisorRecommendation = RecommendationBase &
  (
    | { kind: "choice"; values: string[] }
    | { kind: "text"; text: string }
    | { kind: "alternative"; text: string }
  );

/** Valid records are retained independently; omitted/rejected IDs are explicit. */
export interface AdvisorReport {
  profile: AdvisorProfile;
  recommendations: AdvisorRecommendation[];
  missingQuestionIds: string[];
}

/** Invoke only after acquiring the form lock. Outcome is a copied refresh snapshot. */
export type AdvisorRunner = (
  questionnaire: NormalizedQuestionnaire,
  outcome?: AskUserOutcome,
  signal?: AbortSignal,
) => Promise<AdvisorReport>;
