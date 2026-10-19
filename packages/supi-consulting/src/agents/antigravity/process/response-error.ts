import type { ConsultingFailureReason } from "../../errors.ts";

/** Internal response failure with a fixed reason that survives process error wrapping. */
export class AntigravityResponseError extends Error {
  readonly reason: ConsultingFailureReason;

  constructor(reason: ConsultingFailureReason, options?: ErrorOptions) {
    super(`Antigravity response failure: ${reason}.`, options);
    this.name = "AntigravityResponseError";
    this.reason = reason;
  }
}
