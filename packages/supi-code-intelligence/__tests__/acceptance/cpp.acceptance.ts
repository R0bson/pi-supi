import { registerLanguageBaselineCase } from "./language-baseline-harness.ts";
import { getLanguageCase } from "./language-cases.ts";

registerLanguageBaselineCase(getLanguageCase("cpp"));
