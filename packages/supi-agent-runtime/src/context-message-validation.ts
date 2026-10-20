const STOP_REASONS = new Set([
  "pending",
  "stop",
  "length",
  "toolUse",
  "error",
  "aborted",
  "deferred",
]);

export function validateSessionMessage(message: Record<string, unknown>): boolean {
  if (!isString(message.role) || !isFiniteNumber(message.timestamp)) return false;
  switch (message.role) {
    case "system":
      return validateSystemMessage(message);
    case "user":
      return isNativeContent(message.content, isTextOrImageContent);
    case "assistant":
      return (
        isNativeContent(message.content, isAssistantContent, true) &&
        isString(message.api) &&
        isString(message.provider) &&
        isString(message.model) &&
        STOP_REASONS.has(message.stopReason as string) &&
        isNativeUsage(message.usage) &&
        optionalStrings(message, ["responseModel", "responseId", "providerThinkingLevel"]) &&
        optionalString(message, "thinkingLevel") &&
        optionalBoolean(message, "endTurn") &&
        optionalNonNegative(message, "durationMs")
      );
    case "toolResult":
      return (
        isString(message.toolCallId) &&
        isString(message.toolName) &&
        isNativeContent(message.content, isTextOrImageContent, true) &&
        typeof message.isError === "boolean" &&
        optionalUsage(message) &&
        optionalNestedCalls(message) &&
        optionalNonNegative(message, "durationMs")
      );
    case "bashExecution":
      return (
        isString(message.command) &&
        isString(message.output) &&
        (message.exitCode === undefined || isFiniteNumber(message.exitCode)) &&
        typeof message.cancelled === "boolean" &&
        typeof message.truncated === "boolean" &&
        optionalString(message, "fullOutputPath") &&
        optionalBoolean(message, "excludeFromContext")
      );
    case "custom":
      return (
        isString(message.customType) &&
        isNativeContent(message.content, isTextOrImageContent) &&
        typeof message.display === "boolean"
      );
    case "branchSummary":
      return isString(message.summary) && (message.fromId === null || isString(message.fromId));
    case "compactionSummary":
      return isString(message.summary) && isNonNegativeNumber(message.tokensBefore);
    default:
      return true;
  }
}

export function validateSystemMessage(value: unknown): boolean {
  if (
    !isRecord(value) ||
    value.role !== "system" ||
    !isFiniteNumber(value.timestamp) ||
    !isNativeContent(value.content, isTextContent)
  ) {
    return false;
  }
  if (
    value.sections !== undefined &&
    (!isRecord(value.sections) ||
      !Object.values(value.sections).every((item) => item === null || isString(item)))
  ) {
    return false;
  }
  if (
    value.toolsAdded !== undefined &&
    (!Array.isArray(value.toolsAdded) || !value.toolsAdded.every(isTool))
  ) {
    return false;
  }
  return (
    value.toolsRemoved === undefined ||
    (Array.isArray(value.toolsRemoved) &&
      value.toolsRemoved.every((tool) => isRecord(tool) && isString(tool.name)))
  );
}

export function isAssistantContent(value: unknown): boolean {
  if (isTextContent(value)) return true;
  if (isRecord(value) && value.type === "thinking") {
    return (
      isString(value.thinking) &&
      optionalString(value, "thinkingSignature") &&
      optionalBoolean(value, "redacted")
    );
  }
  return (
    isRecord(value) &&
    value.type === "toolCall" &&
    isString(value.id) &&
    isString(value.name) &&
    isRecord(value.arguments) &&
    optionalStrings(value, ["thoughtSignature", "namespace", "argumentsError"])
  );
}

export function isTextOrImageContent(value: unknown): boolean {
  return (
    isTextContent(value) ||
    (isRecord(value) && value.type === "image" && isString(value.data) && isString(value.mimeType))
  );
}

export function isEditableContent(value: unknown): boolean {
  return isTextOrImageContent(value) || isAssistantContent(value);
}

export function isNativeContent(
  value: unknown,
  accepts: (item: unknown) => boolean,
  arrayOnly = false,
): boolean {
  return (!arrayOnly && isString(value)) || (Array.isArray(value) && value.every(accepts));
}

export function isNativeUsage(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.cost)) return false;
  const cost = value.cost;
  return (
    ["input", "output", "cacheRead", "cacheWrite", "totalTokens"].every((key) =>
      isNonNegativeNumber(value[key]),
    ) &&
    ["input", "output", "cacheRead", "cacheWrite", "total"].every((key) =>
      isNonNegativeNumber(cost[key]),
    ) &&
    optionalNonNegative(value, "cacheWrite1h") &&
    optionalNonNegative(value, "reasoning")
  );
}

function isTool(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isString(value.name) ||
    !isString(value.description) ||
    !isRecord(value.parameters)
  ) {
    return false;
  }
  const sampling = value.constrainedSampling;
  if (sampling === undefined || sampling === false) return true;
  return (
    isRecord(sampling) &&
    ((sampling.type === "json_schema" &&
      ["prefer", "require"].includes(sampling.strict as string)) ||
      (sampling.type === "grammar" && isRecord(sampling.variants)))
  );
}

function isTextContent(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === "text" &&
    isString(value.text) &&
    optionalString(value, "textSignature")
  );
}

function optionalStrings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => optionalString(value, key));
}

function optionalUsage(value: Record<string, unknown>): boolean {
  return value.usage === undefined || isNativeUsage(value.usage);
}

function optionalNestedCalls(value: Record<string, unknown>): boolean {
  if (value.nestedCalls === undefined) return true;
  return (
    isRecord(value.nestedCalls) &&
    typeof value.nestedCalls.complete === "boolean" &&
    Array.isArray(value.nestedCalls.calls) &&
    value.nestedCalls.calls.every(
      (call) =>
        isRecord(call) &&
        isString(call.id) &&
        isString(call.name) &&
        ["ok", "error", "unfinished"].includes(call.status as string) &&
        optionalNonNegative(call, "durationMs") &&
        optionalNonNegative(call, "argumentsBytes") &&
        optionalString(call, "error") &&
        (call.arguments === undefined || isRecord(call.arguments)),
    )
  );
}

function optionalString(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || isString(value[key]);
}

function optionalBoolean(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || typeof value[key] === "boolean";
}

function optionalNonNegative(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || isNonNegativeNumber(value[key]);
}

function isNonNegativeNumber(value: unknown): boolean {
  return isFiniteNumber(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
