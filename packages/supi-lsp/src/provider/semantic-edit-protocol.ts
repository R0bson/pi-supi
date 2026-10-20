import { fileURLToPath } from "node:url";
import type { FileEdit } from "@mrclrchtr/supi-code-runtime/api";

export interface ParsedTextDocumentEdit {
  readonly edit: Record<"textDocument" | "edits", unknown> & { edits: unknown[] };
  readonly textDocument: Record<string, unknown>;
}

export type NormalizedTextEdits =
  | { readonly kind: "precise"; readonly edits: FileEdit[] }
  | { readonly kind: "unavailable"; readonly reason: string };

/** Convert an object-shaped protocol value to a record. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Check that a protocol record has no unknown own keys. */
export function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

/** Reject inherited values for keys that the protocol record may use. */
export function hasNoInheritedAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return allowed.every((key) => !(key in value) || Object.hasOwn(value, key));
}

/** Return the resource-operation kind when a document change is not a text edit. */
export function getResourceOperationKind(value: Record<string, unknown> | null): string | null {
  return value && (value.kind === "create" || value.kind === "rename" || value.kind === "delete")
    ? value.kind
    : null;
}

/** Parse the strict text-document edit shape without establishing its version. */
export function parseTextDocumentEdit(
  edit: Record<string, unknown> | null,
): ParsedTextDocumentEdit | null {
  const textDocument = asRecord(edit?.textDocument);
  if (
    !edit ||
    !Object.hasOwn(edit, "textDocument") ||
    !Object.hasOwn(edit, "edits") ||
    !hasOnlyKeys(edit, ["textDocument", "edits"]) ||
    !hasNoInheritedAllowedKeys(edit, ["textDocument", "edits"]) ||
    !textDocument ||
    !Object.hasOwn(textDocument, "uri") ||
    !hasOnlyKeys(textDocument, ["uri", "version"]) ||
    !hasNoInheritedAllowedKeys(textDocument, ["uri", "version"]) ||
    !Array.isArray(edit.edits)
  ) {
    return null;
  }
  return {
    edit: edit as Record<"textDocument" | "edits", unknown> & { edits: unknown[] },
    textDocument,
  };
}

/** Validate and normalize a complete text-edit collection. */
export function normalizeTextEdits(file: string, values: unknown[]): NormalizedTextEdits {
  const edits: FileEdit[] = [];
  for (const value of values) {
    const textEdit = asRecord(value);
    if (textEdit && Object.hasOwn(textEdit, "snippet")) {
      return { kind: "unavailable", reason: "Workspace edit contains a snippet text edit." };
    }
    if (textEdit && Object.hasOwn(textEdit, "annotationId")) {
      return { kind: "unavailable", reason: "Workspace edit contains a text edit annotation." };
    }
    const range = asRecord(textEdit?.range);
    const start = asPosition(range?.start);
    const end = asPosition(range?.end);
    if (
      !textEdit ||
      !Object.hasOwn(textEdit, "range") ||
      !Object.hasOwn(textEdit, "newText") ||
      !hasOnlyKeys(textEdit, ["range", "newText"]) ||
      !hasNoInheritedAllowedKeys(textEdit, ["range", "newText", "snippet", "annotationId"]) ||
      !range ||
      !Object.hasOwn(range, "start") ||
      !Object.hasOwn(range, "end") ||
      !hasOnlyKeys(range, ["start", "end"]) ||
      !hasNoInheritedAllowedKeys(range, ["start", "end"]) ||
      !start ||
      !end ||
      isBefore(end, start) ||
      typeof textEdit.newText !== "string"
    ) {
      return { kind: "unavailable", reason: "Workspace edit contains a malformed text edit." };
    }
    edits.push({ file, range: { start, end }, newText: textEdit.newText });
  }
  return { kind: "precise", edits };
}

/** Convert an LSP file URI to its local path. */
export function toFilePath(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "file:" ? fileURLToPath(parsed) : null;
  } catch {
    return null;
  }
}

function asPosition(value: unknown): { line: number; character: number } | null {
  const position = asRecord(value);
  return position &&
    Object.hasOwn(position, "line") &&
    Object.hasOwn(position, "character") &&
    hasOnlyKeys(position, ["line", "character"]) &&
    Number.isInteger(position.line) &&
    (position.line as number) >= 0 &&
    Number.isInteger(position.character) &&
    (position.character as number) >= 0
    ? { line: position.line as number, character: position.character as number }
    : null;
}

function isBefore(
  left: { line: number; character: number },
  right: { line: number; character: number },
): boolean {
  return left.line < right.line || (left.line === right.line && left.character < right.character);
}
