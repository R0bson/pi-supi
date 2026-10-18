/** Shared workspace-observation interface for overview and Orientation collection. */

export { observeWorkspace } from "./observe.ts";
export type {
  CollectionLimits,
  DeclaredDependency,
  DeclaredPath,
  InventoryEntry,
  InventoryEntryKind,
  InventorySource,
  InventoryStopReason,
  MetadataDocument,
  MetadataDocumentKind,
  MetadataIssue,
  MetadataIssueKind,
  ObserveWorkspaceOptions,
  ProjectDeclaration,
  ProjectKind,
  ProjectMembership,
  ProjectRelationship,
  WorkspaceCollection,
  WorkspaceDeclaration,
  WorkspaceInclusionPolicy,
  WorkspaceInventory,
  WorkspaceMetadataObservation,
  WorkspaceObservation,
  WorkspaceObservationError,
} from "./types.ts";
