import type { SourceRange } from "@mrclrchtr/supi-code-runtime/api";

export interface TargetDiscoveryResult<T> {
  readonly available: boolean;
  readonly targets: readonly T[];
  readonly partial?: { readonly reason: string; readonly errorRanges: readonly SourceRange[] };
}

/** Combine provider recovery without discarding structurally usable targets. */
export function mergeDiscoveryPartial(
  semantic: TargetDiscoveryResult<unknown>,
  structural: TargetDiscoveryResult<unknown>,
): { partial?: { reason: string; errorRanges: readonly SourceRange[] } } {
  const partials = [semantic.partial, structural.partial].filter(
    (partial): partial is NonNullable<TargetDiscoveryResult<unknown>["partial"]> =>
      partial !== undefined,
  );
  if (partials.length === 0) return {};
  const ranges = new Map<string, SourceRange>();
  for (const partial of partials) {
    for (const range of partial.errorRanges) ranges.set(JSON.stringify(range), range);
  }
  return {
    partial: {
      reason: partials.map((partial) => partial.reason).join(" "),
      errorRanges: [...ranges.values()],
    },
  };
}
