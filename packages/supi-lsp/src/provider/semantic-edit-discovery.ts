import {
  asRecord,
  getResourceOperationKind,
  hasNoInheritedAllowedKeys,
  hasOnlyKeys,
  normalizeTextEdits,
  parseTextDocumentEdit,
  toFilePath,
} from "./semantic-edit-protocol.ts";

export const MAX_RENAME_DOCUMENTS = 64;

type DiscoveryResult =
  | { readonly kind: "valid"; readonly files: readonly string[] }
  | { readonly kind: "unavailable"; readonly reason: string };

type DiscoveredDocument =
  | { readonly kind: "valid"; readonly file: string; readonly editCount: number }
  | { readonly kind: "unavailable"; readonly reason: string };

/** Validate a complete workspace edit and list its text-edit document paths. */
export function discoverSemanticEditFiles(value: unknown): DiscoveryResult {
  const workspaceEdit = parseWorkspaceEdit(value);
  if (typeof workspaceEdit === "string") {
    return { kind: "unavailable", reason: workspaceEdit };
  }
  return Object.hasOwn(workspaceEdit, "documentChanges")
    ? discoverDocumentChanges(workspaceEdit.documentChanges)
    : discoverChangesMap(workspaceEdit.changes);
}

function parseWorkspaceEdit(value: unknown): Record<string, unknown> | string {
  const workspaceEdit = asRecord(value);
  if (
    !workspaceEdit ||
    !hasOnlyKeys(workspaceEdit, ["changes", "documentChanges", "changeAnnotations"]) ||
    !hasNoInheritedAllowedKeys(workspaceEdit, ["changes", "documentChanges", "changeAnnotations"])
  ) {
    return "LSP server returned a malformed workspace edit.";
  }
  if (Object.hasOwn(workspaceEdit, "changeAnnotations")) {
    return "Workspace edit contains unsupported change annotations.";
  }
  return workspaceEdit;
}

function discoverDocumentChanges(value: unknown): DiscoveryResult {
  if (!Array.isArray(value)) {
    return { kind: "unavailable", reason: "Workspace edit has malformed documentChanges." };
  }
  const files = new Set<string>();
  let editCount = 0;
  for (const change of value) {
    const result = discoverDocumentChange(change);
    if (result.kind === "unavailable") return result;
    if (result.editCount > 0) {
      files.add(result.file);
      if (files.size > MAX_RENAME_DOCUMENTS) {
        return {
          kind: "unavailable",
          reason: "Rename affects too many files to synchronize safely.",
        };
      }
      editCount += result.editCount;
    }
  }
  return finishDiscovery(files, editCount);
}

function discoverDocumentChange(value: unknown): DiscoveredDocument {
  const documentEdit = asRecord(value);
  const resourceKind = getResourceOperationKind(documentEdit);
  if (resourceKind) {
    return {
      kind: "unavailable",
      reason: `Workspace edit contains the unsupported "${resourceKind}" resource operation.`,
    };
  }
  const parsed = parseTextDocumentEdit(documentEdit);
  if (!parsed) {
    return { kind: "unavailable", reason: "Workspace edit has a malformed document change." };
  }
  const uri = parsed.textDocument.uri;
  const file = typeof uri === "string" ? toFilePath(uri) : null;
  if (!file) {
    return { kind: "unavailable", reason: "Document change does not contain a valid file URI." };
  }
  if (!hasValidDocumentVersion(parsed.textDocument.version, parsed.textDocument)) {
    return {
      kind: "unavailable",
      reason: `Document change for "${file}" has an invalid version.`,
    };
  }
  const normalized = normalizeTextEdits(file, parsed.edit.edits);
  if (normalized.kind === "unavailable") return normalized;
  return { kind: "valid", file, editCount: normalized.edits.length };
}

function hasValidDocumentVersion(version: unknown, textDocument: Record<string, unknown>): boolean {
  return (
    Object.hasOwn(textDocument, "version") &&
    (version === null || (Number.isInteger(version) && (version as number) >= 0))
  );
}

function discoverChangesMap(value: unknown): DiscoveryResult {
  const changes = asRecord(value);
  if (!changes) {
    return { kind: "unavailable", reason: "Workspace edit contains no supported changes." };
  }
  const files = new Set<string>();
  let editCount = 0;
  for (const uri of Object.keys(changes).sort((left, right) => left.localeCompare(right))) {
    const result = discoverChangesEntry(uri, changes[uri]);
    if (result.kind === "unavailable") return result;
    if (result.editCount > 0) {
      files.add(result.file);
      if (files.size > MAX_RENAME_DOCUMENTS) {
        return {
          kind: "unavailable",
          reason: "Rename affects too many files to synchronize safely.",
        };
      }
      editCount += result.editCount;
    }
  }
  return finishDiscovery(files, editCount);
}

function discoverChangesEntry(uri: string, value: unknown): DiscoveredDocument {
  const file = toFilePath(uri);
  if (!file) {
    return { kind: "unavailable", reason: `Workspace edit URI "${uri}" is not a file URI.` };
  }
  if (!Array.isArray(value)) {
    return { kind: "unavailable", reason: "Workspace edit contains malformed changes." };
  }
  const normalized = normalizeTextEdits(file, value);
  if (normalized.kind === "unavailable") return normalized;
  return { kind: "valid", file, editCount: normalized.edits.length };
}

function finishDiscovery(files: Set<string>, editCount: number): DiscoveryResult {
  if (files.size > MAX_RENAME_DOCUMENTS) {
    return { kind: "unavailable", reason: "Rename affects too many files to synchronize safely." };
  }
  if (editCount === 0) {
    return { kind: "unavailable", reason: "Workspace edit contains no file edits." };
  }
  return { kind: "valid", files: [...files].sort((left, right) => left.localeCompare(right)) };
}
