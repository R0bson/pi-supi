export interface DiagnosticFixMessage {
  readonly line: number;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly source?: string;
}

interface DiagnosticFixEntry {
  readonly file: string;
  readonly errors: number;
  readonly messages?: readonly DiagnosticFixMessage[];
}

interface DiagnosticFixData {
  readonly diagnosticObservation: {
    readonly kind: "not-requested" | "completed" | "partial" | "unavailable";
    readonly entries: readonly DiagnosticFixEntry[];
  };
}

interface WaitForDiagnosticFixOptions<T extends DiagnosticFixData> {
  readonly observe: () => Promise<T>;
  readonly file: string;
  readonly previous: readonly DiagnosticFixMessage[];
  readonly control: readonly DiagnosticFixMessage[];
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

/** Wait for a bounded diagnostic observation that no longer reports known errors. */
export async function waitForDiagnosticFix<T extends DiagnosticFixData>(
  options: WaitForDiagnosticFixOptions<T>,
): Promise<T> {
  if (options.previous.length === 0) {
    throw new Error("At least one known diagnostic is required.");
  }
  if (options.control.length === 0) {
    throw new Error("At least one independent control diagnostic is required.");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("The diagnostic observation timeout must be positive.");
  }
  if (!Number.isFinite(options.pollIntervalMs) || options.pollIntervalMs <= 0) {
    throw new Error("The diagnostic polling interval must be positive.");
  }

  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + options.timeoutMs;
  let latest: T | undefined;
  while (now() < deadline) {
    const result = await options.observe();
    latest = result;
    if (
      now() <= deadline &&
      noLongerReportsKnownErrors(result, options.file, options.previous, options.control)
    ) {
      return result;
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(options.pollIntervalMs, remaining));
  }

  const lastObservation = latest?.diagnosticObservation;
  const lastState = lastObservation
    ? `${lastObservation.kind}: ${JSON.stringify(
        lastObservation.entries.filter((entry) => entry.file === options.file),
      )}`
    : "no observation";
  throw new Error(
    `The known diagnostic for ${options.file} did not change within ${options.timeoutMs} ms; last state: ${lastState}.`,
  );
}

function noLongerReportsKnownErrors(
  data: DiagnosticFixData,
  file: string,
  previous: readonly DiagnosticFixMessage[],
  control: readonly DiagnosticFixMessage[],
): boolean {
  const observation = data.diagnosticObservation;
  if (observation.kind !== "completed" && observation.kind !== "partial") return false;

  const entries = observation.entries.filter((entry) => entry.file === file);
  if (entries.length === 0 || entries.some((entry) => !entry.messages)) return false;

  const currentErrors = entries.flatMap((entry) =>
    (entry.messages ?? []).filter((message) => message.severity === "error"),
  );
  if (
    entries.some(
      (entry) =>
        entry.errors !==
        (entry.messages ?? []).filter((message) => message.severity === "error").length,
    )
  ) {
    return false;
  }

  const includes = (expected: DiagnosticFixMessage) =>
    currentErrors.some((current) => diagnosticKey(current) === diagnosticKey(expected));
  return (
    currentErrors.length > 0 &&
    control.every(includes) &&
    previous.every((known) => !includes(known))
  );
}

function diagnosticKey(message: DiagnosticFixMessage): string {
  return JSON.stringify([message.line, message.severity, message.message]);
}
