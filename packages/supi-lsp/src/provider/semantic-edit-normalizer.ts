import type {
  DocumentEditPrecondition,
  FileEdit,
  RefactorResult,
} from "@mrclrchtr/supi-code-runtime/api";
import {
  asRecord,
  getResourceOperationKind,
  hasNoInheritedAllowedKeys,
  hasOnlyKeys,
  normalizeTextEdits,
  parseTextDocumentEdit,
  toFilePath,
} from "./semantic-edit-protocol.ts";

/** A complete semantic server response that can contain precise text edits. */
export type SemanticEditResponse =
  | { readonly kind: "workspace-edit"; readonly edit: unknown }
  | { readonly kind: "code-action"; readonly action: unknown };

/** Provider route and client document state used to establish mutation preconditions. */
export interface SemanticDocumentSnapshotEvidence {
  readonly version: number;
  readonly contentFingerprint: string;
  readonly diskContentFingerprint: string;
}

export interface SemanticEditNormalizationContext {
  getOpenDocumentVersion(file: string): number | null;
  getSynchronizedDocumentSnapshot?(file: string): SemanticDocumentSnapshotEvidence | null;
  authorizedMutationRoots: readonly string[];
}

/**
 * Convert one complete semantic server response to a protocol-neutral edit plan.
 * Reject the complete response when any part is not supported.
 */
export function normalizeSemanticEdit(
  response: SemanticEditResponse,
  context: SemanticEditNormalizationContext,
): RefactorResult {
  return response.kind === "code-action"
    ? normalizeCodeAction(response.action, context)
    : normalizeWorkspaceEdit(response.edit, context);
}

function normalizeCodeAction(
  value: unknown,
  context: SemanticEditNormalizationContext,
): RefactorResult {
  const action = asRecord(value);
  if (
    !action ||
    !Object.hasOwn(action, "title") ||
    typeof action.title !== "string" ||
    action.title.trim().length === 0 ||
    !hasOnlyKeys(action, [
      "title",
      "kind",
      "diagnostics",
      "isPreferred",
      "disabled",
      "edit",
      "command",
      "data",
    ]) ||
    !hasNoInheritedAllowedKeys(action, [
      "title",
      "kind",
      "diagnostics",
      "isPreferred",
      "disabled",
      "edit",
      "command",
      "data",
    ])
  ) {
    return { kind: "unavailable", reason: "LSP server returned a malformed code action." };
  }
  const title = action.title;
  if (
    Object.hasOwn(action, "kind") &&
    (typeof action.kind !== "string" || action.kind.trim().length === 0)
  ) {
    return { kind: "unavailable", reason: `Code action "${title}" has a malformed kind.` };
  }
  if (Object.hasOwn(action, "diagnostics") && !Array.isArray(action.diagnostics)) {
    return { kind: "unavailable", reason: `Code action "${title}" has malformed diagnostics.` };
  }
  if (Object.hasOwn(action, "isPreferred") && typeof action.isPreferred !== "boolean") {
    return { kind: "unavailable", reason: `Code action "${title}" has a malformed preference.` };
  }
  if (Object.hasOwn(action, "disabled")) {
    return { kind: "unavailable", reason: `Code action "${title}" is disabled.` };
  }
  if (Object.hasOwn(action, "command")) {
    return {
      kind: "unavailable",
      reason: `Code action "${title}" requires a command and cannot become an edit-only precise plan.`,
    };
  }
  if (!Object.hasOwn(action, "edit")) {
    return { kind: "unavailable", reason: `Code action "${title}" has no edit` };
  }
  const result = normalizeWorkspaceEdit(action.edit, context);
  return result.kind === "unavailable"
    ? {
        kind: "unavailable",
        reason: `Code action "${title}" could not produce precise edits: ${result.reason}`,
      }
    : result;
}

function normalizeWorkspaceEdit(
  value: unknown,
  context: SemanticEditNormalizationContext,
): RefactorResult {
  if (value === null || value === undefined) {
    return { kind: "unavailable", reason: "LSP server returned no edit." };
  }
  const workspaceEdit = asRecord(value);
  if (
    !workspaceEdit ||
    !hasOnlyKeys(workspaceEdit, ["changes", "documentChanges", "changeAnnotations"]) ||
    !hasNoInheritedAllowedKeys(workspaceEdit, ["changes", "documentChanges", "changeAnnotations"])
  ) {
    return { kind: "unavailable", reason: "LSP server returned a malformed workspace edit." };
  }
  if (Object.hasOwn(workspaceEdit, "changeAnnotations")) {
    return {
      kind: "unavailable",
      reason: "Workspace edit contains unsupported change annotations.",
    };
  }
  const hasDocumentChanges = Object.hasOwn(workspaceEdit, "documentChanges");
  return hasDocumentChanges
    ? normalizeDocumentChanges(workspaceEdit.documentChanges, context)
    : normalizeChanges(workspaceEdit.changes, context);
}

function normalizeChanges(
  value: unknown,
  context: SemanticEditNormalizationContext,
): RefactorResult {
  const changes = asRecord(value);
  if (!changes) {
    return { kind: "unavailable", reason: "Workspace edit contains no supported changes." };
  }

  const edits: FileEdit[] = [];
  const documentPreconditions: DocumentEditPrecondition[] = [];
  for (const uri of Object.keys(changes).sort((left, right) => left.localeCompare(right))) {
    const result = normalizeChangesEntry(uri, changes[uri], context);
    if (result.kind === "unavailable") return result;
    edits.push(...result.edits);
    if (result.precondition) documentPreconditions.push(result.precondition);
  }
  return preciseOrEmpty(
    edits,
    context,
    documentPreconditions.length > 0 ? documentPreconditions : undefined,
  );
}

function normalizeChangesEntry(
  uri: string,
  value: unknown,
  context: SemanticEditNormalizationContext,
):
  | { kind: "precise"; edits: FileEdit[]; precondition?: DocumentEditPrecondition }
  | { kind: "unavailable"; reason: string } {
  const file = toFilePath(uri);
  if (!file) {
    return { kind: "unavailable", reason: `Workspace edit URI "${uri}" is not a file URI.` };
  }
  if (!Array.isArray(value)) {
    return { kind: "unavailable", reason: "Workspace edit contains malformed changes." };
  }
  const normalized = normalizeTextEdits(file, value);
  if (normalized.kind === "unavailable") return normalized;
  if (!context.getSynchronizedDocumentSnapshot) {
    return { kind: "precise", edits: normalized.edits };
  }
  const precondition = establishSynchronizedContentPrecondition(file, context, false);
  if (typeof precondition === "string") return { kind: "unavailable", reason: precondition };
  return {
    kind: "precise",
    edits: normalized.edits,
    ...(precondition ? { precondition } : {}),
  };
}

function normalizeDocumentChanges(
  value: unknown,
  context: SemanticEditNormalizationContext,
): RefactorResult {
  if (!Array.isArray(value)) {
    return { kind: "unavailable", reason: "Workspace edit has malformed documentChanges." };
  }

  const edits: FileEdit[] = [];
  const documentPreconditions: DocumentEditPrecondition[] = [];
  for (const change of value) {
    const normalized = normalizeDocumentChange(change, context);
    if (normalized.kind === "unavailable") return normalized;
    edits.push(...normalized.edits);
    documentPreconditions.push(normalized.precondition);
  }
  return preciseOrEmpty(edits, context, documentPreconditions);
}

function normalizeDocumentChange(
  value: unknown,
  context: SemanticEditNormalizationContext,
):
  | { kind: "precise"; edits: FileEdit[]; precondition: DocumentEditPrecondition }
  | { kind: "unavailable"; reason: string } {
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
  const { edit, textDocument } = parsed;
  const file = typeof textDocument.uri === "string" ? toFilePath(textDocument.uri) : null;
  if (!file) {
    return { kind: "unavailable", reason: "Document change does not contain a valid file URI." };
  }
  if (!Object.hasOwn(textDocument, "version")) {
    return { kind: "unavailable", reason: "Document change does not contain a version." };
  }
  const precondition = establishPrecondition(file, textDocument.version, context);
  if (typeof precondition === "string") {
    return { kind: "unavailable", reason: precondition };
  }
  const normalized = normalizeTextEdits(file, edit.edits);
  return normalized.kind === "unavailable"
    ? normalized
    : { kind: "precise", edits: normalized.edits, precondition };
}

function establishPrecondition(
  file: string,
  version: unknown,
  context: SemanticEditNormalizationContext,
): DocumentEditPrecondition | string {
  const openVersion = context.getOpenDocumentVersion(file);
  if (version === null) {
    if (openVersion === null) {
      return context.getSynchronizedDocumentSnapshot?.(file)
        ? `Document change for "${file}" is no longer open after its synchronized snapshot.`
        : { file, kind: "disk-content" };
    }
    const precondition = establishSynchronizedContentPrecondition(file, context, true, openVersion);
    return precondition ?? `Document change for "${file}" has no verified content precondition.`;
  }
  if (!Number.isInteger(version) || (version as number) < 0) {
    return `Document change for "${file}" has an invalid version.`;
  }
  if (openVersion === null) {
    return `Document change version for "${file}" cannot be established.`;
  }
  if (openVersion !== version) {
    return `Document change version for "${file}" does not match the open document.`;
  }
  if (context.getSynchronizedDocumentSnapshot?.(file)) {
    return (
      establishSynchronizedContentPrecondition(file, context, true, version as number) ??
      `Document change for "${file}" has no verified content precondition.`
    );
  }
  return { file, kind: "open-document-version", version: version as number };
}

function establishSynchronizedContentPrecondition(
  file: string,
  context: SemanticEditNormalizationContext,
  required: boolean,
  expectedVersion?: number,
): DocumentEditPrecondition | null | string {
  const openVersion = context.getOpenDocumentVersion(file);
  const snapshot = context.getSynchronizedDocumentSnapshot?.(file);
  if (openVersion === null) {
    if (required || snapshot) {
      return `Document change for "${file}" requires verified synchronized content, but the document is closed.`;
    }
    return null;
  }
  if (!snapshot) {
    return required
      ? `Document change for "${file}" requires a verified synchronized content snapshot, but the document is open without one.`
      : `Open document "${file}" has no verified synchronized content snapshot.`;
  }
  if (
    snapshot.version !== openVersion ||
    (expectedVersion !== undefined && snapshot.version !== expectedVersion) ||
    snapshot.contentFingerprint.length === 0 ||
    snapshot.contentFingerprint !== snapshot.diskContentFingerprint
  ) {
    return `Document change for "${file}" does not match its synchronized content snapshot.`;
  }
  return {
    file,
    kind: "open-document-content",
    version: snapshot.version,
    fingerprint: snapshot.contentFingerprint,
  };
}

function preciseOrEmpty(
  edits: FileEdit[],
  context: SemanticEditNormalizationContext,
  documentPreconditions?: DocumentEditPrecondition[],
): RefactorResult {
  if (edits.length === 0) {
    return { kind: "unavailable", reason: "Workspace edit contains no file edits." };
  }
  if (context.authorizedMutationRoots.length === 0) {
    return {
      kind: "unavailable",
      reason: "Semantic route did not authorize a mutation root.",
    };
  }
  const authorizedMutationRoots = [...context.authorizedMutationRoots];
  return documentPreconditions
    ? { kind: "precise", edits: { edits, documentPreconditions }, authorizedMutationRoots }
    : { kind: "precise", edits: { edits }, authorizedMutationRoots };
}
