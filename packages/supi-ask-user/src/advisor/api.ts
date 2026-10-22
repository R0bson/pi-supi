/** Opt-in advisor API. The automatic ask_user adapter owns its own invocation and form locking. */
export { createAdvisorRunner } from "./runner.ts";
export type { AdvisorConfig } from "./settings.ts";
export { ADVISOR_DEFAULTS, loadAdvisorConfig, registerAdvisorSettings } from "./settings.ts";
export type {
  AdvisorEvidence,
  AdvisorProfile,
  AdvisorRecommendation,
  AdvisorReport,
  AdvisorRunner,
} from "./types.ts";
