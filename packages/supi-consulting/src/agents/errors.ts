const FAILURE_MESSAGES = {
  unavailable: "The Consulting Agent is unavailable. Reload PI to check availability.",
  timeout: "The Consultation timed out.",
  cancelled: "The Consultation was canceled.",
  "invalid-response": "The Consulting Agent returned an invalid response.",
  "invalid-continuation": "Invalid Conversation Handle continuation state.",
  "conversation-mismatch":
    "The Consulting Agent returned a different conversation for this handle.",
  execution: "Consultation execution failed.",
} as const;

const FAILURE_REASON_MESSAGES = {
  "missing-terminal": "The Consulting Agent did not return a final result.",
  "terminal-failed": "The Consulting Agent reported an unsuccessful final result.",
  "missing-answer": "The Consulting Agent did not return a final structured answer.",
  "invalid-answer":
    "The Consulting Agent returned an answer that does not match the required schema.",
  "missing-conversation": "The Consulting Agent did not return a conversation identifier.",
  "events-after-terminal": "The Consulting Agent sent data after its final result.",
  "malformed-json": "The Consulting Agent returned malformed JSON.",
  "invalid-event": "The Consulting Agent returned a non-object response event.",
  "stdout-line-limit": "The Consulting Agent response exceeded the line-size limit.",
  "stdout-byte-limit": "The Consulting Agent response exceeded the total output-size limit.",
  "event-limit": "The Consulting Agent response exceeded the event limit.",
} as const;

/** Fixed failure reasons that do not contain agent output. */
export type ConsultingFailureReason = keyof typeof FAILURE_REASON_MESSAGES;

/** Execution facts that can leave the adapter on failure. No resource names or raw output. */
export interface ConsultingFailureDiagnostics {
  permissionDenials?: number;
  eventCount?: number;
  terminalSeen?: boolean;
  terminalSucceeded?: boolean;
  exitCode?: number | null;
}

/** Safe failure categories that can leave a private Consulting Agent adapter. */
export type ConsultingAgentFailureKind = keyof typeof FAILURE_MESSAGES;

/**
 * A bounded failure with fixed messages and safe execution facts, but no raw cause.
 * Permission denials are observations, not a claim about the cause of failure.
 */
export class ConsultingAgentError extends Error {
  readonly kind: ConsultingAgentFailureKind;
  readonly reason: ConsultingFailureReason | undefined;
  readonly diagnostics: ConsultingFailureDiagnostics | undefined;

  constructor(
    kind: ConsultingAgentFailureKind,
    options: { reason?: ConsultingFailureReason; diagnostics?: ConsultingFailureDiagnostics } = {},
  ) {
    const message = options.reason
      ? FAILURE_REASON_MESSAGES[options.reason]
      : FAILURE_MESSAGES[kind];
    const denial = (options.diagnostics?.permissionDenials ?? 0) > 0;
    super(
      `${message}${denial ? " A tool permission denial was observed. Check the requested resources and the Consulting Agent permissions." : ""}`,
    );
    this.name = "ConsultingAgentError";
    this.kind = kind;
    this.reason = options.reason;
    const facts = options.diagnostics;
    this.diagnostics = facts
      ? {
          permissionDenials: facts.permissionDenials,
          eventCount: facts.eventCount,
          terminalSeen: facts.terminalSeen,
          terminalSucceeded: facts.terminalSucceeded,
          exitCode: facts.exitCode,
        }
      : undefined;
  }
}
