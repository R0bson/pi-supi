/** Internal metadata document and workspace-configuration shapes. */

import type {
  DeclaredDependency,
  DeclaredPath,
  MetadataDocument,
  MetadataDocumentKind,
  MetadataIssue,
  ProjectDeclaration,
  ProjectKind,
  WorkspaceDeclaration,
} from "./types.ts";

/** One successfully parsed metadata document. */
export interface ParsedDocument {
  readonly path: string;
  readonly kind: MetadataDocumentKind;
  readonly directory: string;
  readonly data: unknown;
}

/** Metadata documents plus successful parses. */
export interface MetadataReadResult {
  readonly documents: readonly MetadataDocument[];
  readonly parsed: readonly ParsedDocument[];
  readonly issues: readonly MetadataIssue[];
  readonly deadlineReached: boolean;
}

/** One explicit workspace-membership declaration. */
export type WorkspaceConfig = WorkspaceDeclaration;

/** Facts extracted from one parsed document. */
export interface DocumentContribution {
  readonly project: ProjectDeclaration | null;
  readonly workspace: WorkspaceConfig | null;
  readonly issues: readonly MetadataIssue[];
}

/** Mutable project assembly data before runtime freezing. */
export interface ProjectDraft {
  readonly id: string;
  readonly manifestPath: string;
  readonly kind: ProjectKind;
  readonly directory: string;
  readonly name: string | null;
  readonly nameField: string | null;
  readonly description: string | null;
  readonly descriptionField: string | null;
  readonly memberships: ProjectMembershipDraft[];
  readonly declaredPaths: readonly DeclaredPath[];
  readonly dependencies: readonly DeclaredDependency[];
}

/** Mutable membership list used only before the result is frozen. */
export type ProjectMembershipDraft = import("./types.ts").ProjectMembership;
