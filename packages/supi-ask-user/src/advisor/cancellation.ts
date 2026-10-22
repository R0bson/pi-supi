/** Throw a fixed cancellation error, never a caller's potentially sensitive abort reason. */
export function checkAdvisorAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Advisor cancelled.", "AbortError");
}
