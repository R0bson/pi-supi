import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { cloneSessionData } from "./context-data.ts";
import {
  isAssistantContent,
  isEditableContent,
  isNativeContent,
  isNativeUsage,
  isTextOrImageContent,
  validateSessionMessage,
  validateSystemMessage,
} from "./context-message-validation.ts";
import type { AgentRunContext } from "./types.ts";

const ENTRY_TYPES = new Set([
  "message",
  "thinking_level_change",
  "model_change",
  "usage",
  "compaction",
  "branch_summary",
  "custom",
  "custom_message",
  "context_edit",
  "label",
  "session_info",
]);
const ASSISTANT_METADATA_TO_OMIT = ["diagnostics", "deferred", "errorMessage", "rawStopReason"];

/** Copy a context and validate its native session entries. */
export function cloneAndValidateContext(value: AgentRunContext): AgentRunContext {
  let data: unknown;
  try {
    data = cloneSessionData(value);
  } catch (error) {
    throw new TypeError("Invalid Agent Run context: entries must contain plain session data", {
      cause: error,
    });
  }
  if (!isRecord(data) || !Array.isArray(data.entries)) {
    throw new TypeError("Invalid Agent Run context: entries and leafId are required");
  }
  if (data.leafId !== null && typeof data.leafId !== "string") {
    throw new TypeError("Invalid Agent Run context: leafId must be a string or null");
  }
  const entries = data.entries.map(validateEntry);
  const byId = validateAncestry(entries, data.leafId);
  validateReferences(entries, byId);
  return { entries, leafId: data.leafId };
}

function validateEntry(value: unknown): SessionEntry {
  if (
    !isRecord(value) ||
    !ENTRY_TYPES.has(value.type as string) ||
    !isString(value.id) ||
    !value.id ||
    (value.parentId !== null && !isString(value.parentId)) ||
    !isString(value.timestamp)
  )
    throw invalid("entry");

  if (!validateEntryPayload(value)) throw invalid(`${value.type} entry`);
  const entry = value as unknown as SessionEntry;
  if (entry.type !== "message" || entry.message.role !== "assistant") return entry;
  const message = { ...entry.message } as Record<string, unknown>;
  for (const key of ASSISTANT_METADATA_TO_OMIT) delete message[key];
  return { ...entry, message } as unknown as SessionEntry;
}

function validateEntryPayload(entry: Record<string, unknown>): boolean {
  switch (entry.type) {
    case "message":
      return isRecord(entry.message) && validateSessionMessage(entry.message);
    case "thinking_level_change":
      return isString(entry.thinkingLevel);
    case "model_change":
      return isString(entry.provider) && isString(entry.modelId);
    case "usage":
      return (
        isString(entry.kind) &&
        isString(entry.provider) &&
        isString(entry.model) &&
        isNativeUsage(entry.usage)
      );
    case "compaction":
      return (
        isString(entry.summary) &&
        isString(entry.firstKeptEntryId) &&
        nonNegative(entry.tokensBefore) &&
        optionalUsage(entry) &&
        optionalBoolean(entry, "fromHook") &&
        (entry.systemMessage === undefined || validateSystemMessage(entry.systemMessage))
      );
    case "branch_summary":
      return (
        isString(entry.fromId) &&
        isString(entry.summary) &&
        optionalUsage(entry) &&
        optionalBoolean(entry, "fromHook")
      );
    case "custom":
      return isString(entry.customType);
    case "custom_message":
      return (
        isString(entry.customType) &&
        isNativeContent(entry.content, isTextOrImageContent) &&
        typeof entry.display === "boolean"
      );
    case "context_edit":
      return (
        isString(entry.targetId) &&
        Object.hasOwn(entry, "replacement") &&
        (entry.replacement === null ||
          (isRecord(entry.replacement) &&
            Object.hasOwn(entry.replacement, "content") &&
            isNativeContent(entry.replacement.content, isEditableContent)))
      );
    case "label":
      return isString(entry.targetId) && (entry.label === undefined || isString(entry.label));
    case "session_info":
      return entry.name === undefined || isString(entry.name);
    default:
      return false;
  }
}

function validateReferences(
  entries: readonly SessionEntry[],
  byId: ReadonlyMap<string, SessionEntry>,
): void {
  for (const entry of entries) {
    const path = entryPath(entry, byId);
    if (
      entry.type === "compaction" &&
      entry.firstKeptEntryId !== entry.id &&
      !path.slice(1).some((item) => item.id === entry.firstKeptEntryId)
    ) {
      throw invalid("compaction boundary is not on its ancestry");
    }
    if (entry.type === "context_edit") validateContextEdit(entry, path, byId);
    // Pi uses "root" when a branch summary has no previous leaf.
    if (entry.type === "branch_summary" && entry.fromId !== "root" && !byId.has(entry.fromId)) {
      throw invalid("branch summary source does not exist");
    }
    if (entry.type === "label" && !byId.has(entry.targetId))
      throw invalid("label target does not exist");
  }
}

function validateContextEdit(
  entry: Extract<SessionEntry, { type: "context_edit" }>,
  path: SessionEntry[],
  byId: ReadonlyMap<string, SessionEntry>,
): void {
  const target = byId.get(entry.targetId);
  if (
    !target ||
    !path.slice(1).some((item) => item.id === entry.targetId) ||
    !isEditableTarget(target)
  ) {
    throw invalid("context edit target is not an earlier editable entry on its branch");
  }
  if (entry.replacement !== null && !replacementMatchesTarget(target, entry.replacement.content)) {
    throw invalid("context edit content does not match its target");
  }
}

function replacementMatchesTarget(target: SessionEntry, content: unknown): boolean {
  if (target.type === "custom_message") return isNativeContent(content, isTextOrImageContent);
  if (target.type !== "message") return false;
  if (target.message.role === "assistant") return isNativeContent(content, isAssistantContent);
  if (target.message.role === "user") return isNativeContent(content, isTextOrImageContent);
  return target.message.role === "toolResult" && isNativeContent(content, isTextOrImageContent);
}

function isEditableTarget(entry: SessionEntry): boolean {
  return (
    entry.type === "custom_message" ||
    (entry.type === "message" && ["user", "assistant", "toolResult"].includes(entry.message.role))
  );
}

function validateAncestry(
  entries: readonly SessionEntry[],
  leafId: unknown,
): Map<string, SessionEntry> {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  if (byId.size !== entries.length) throw invalid("entry IDs must be unique");
  if (leafId !== null && !byId.has(leafId as string))
    throw invalid("leafId does not identify an entry");
  const complete = new Set<string>();
  for (const entry of entries) validateEntryAncestry(entry, byId, complete);
  return byId;
}

function validateEntryAncestry(
  entry: SessionEntry,
  byId: ReadonlyMap<string, SessionEntry>,
  complete: Set<string>,
): void {
  const path = new Set<string>();
  let current: SessionEntry | undefined = entry;
  while (current && !complete.has(current.id)) {
    if (path.has(current.id)) throw invalid("entry ancestry contains a cycle");
    path.add(current.id);
    if (current.parentId === null) break;
    current = byId.get(current.parentId);
    if (!current) throw invalid("entry ancestry is incomplete");
  }
  for (const id of path) complete.add(id);
}

function entryPath(entry: SessionEntry, byId: ReadonlyMap<string, SessionEntry>): SessionEntry[] {
  const path = [entry];
  let current = entry;
  while (current.parentId !== null) {
    current = byId.get(current.parentId) as SessionEntry;
    path.push(current);
  }
  return path;
}

function optionalUsage(value: Record<string, unknown>): boolean {
  return value.usage === undefined || isNativeUsage(value.usage);
}

function optionalBoolean(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || typeof value[key] === "boolean";
}

function nonNegative(value: unknown): boolean {
  return finite(value) && value >= 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(detail: string): TypeError {
  return new TypeError(`Invalid Agent Run context: ${detail}`);
}
