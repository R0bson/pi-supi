/** Cargo.toml package, workspace, path, and dependency declaration reader. */

import type { DocumentContribution, ParsedDocument, WorkspaceConfig } from "./metadata-types.ts";
import {
  baseProject,
  childField,
  isRecord,
  issue,
  stringArray,
  stringValue,
} from "./metadata-utils.ts";
import type { DeclaredDependency, DeclaredPath, MetadataIssue } from "./types.ts";

const DEPENDENCY_FIELDS = ["dependencies", "dev-dependencies", "build-dependencies"] as const;

/** Read one Cargo.toml without resolving inherited or build-time behavior. */
export function readRustDocument(document: ParsedDocument): DocumentContribution {
  if (!isRecord(document.data)) {
    return {
      project: null,
      workspace: null,
      issues: [issue(document.path, null, "malformed", "Cargo.toml must contain a TOML table.")],
    };
  }
  const issues: MetadataIssue[] = [];
  const project = readRustProject(document, issues);
  return {
    project,
    workspace: readCargoWorkspace(document, issues),
    issues,
  };
}

function readRustProject(
  document: ParsedDocument,
  issues: MetadataIssue[],
): DocumentContribution["project"] {
  if (!isRecord(document.data) || !Object.hasOwn(document.data, "package")) return null;
  const pkg = document.data.package;
  if (!isRecord(pkg)) {
    issues.push(
      issue(document.path, "package", "malformed", "Cargo.toml#package must be a table."),
    );
    return null;
  }
  const name = readString(packageValue(document.path, pkg, "name", issues));
  const description = readString(packageValue(document.path, pkg, "description", issues));
  if (Object.hasOwn(pkg, "workspace")) {
    issues.push(
      issue(
        document.path,
        "package.workspace",
        "unresolved",
        "Explicit package.workspace reference is retained as a limitation; workspace-reference resolution is not supported.",
      ),
    );
  }
  const base = baseProject({
    manifestPath: document.path,
    kind: "rust-package",
    directory: document.directory,
    name,
    nameField: name === null ? null : "package.name",
    description,
    descriptionField: description === null ? null : "package.description",
  });
  return {
    ...base,
    declaredPaths: collectCargoPaths(document.data, document.path, issues),
    dependencies: collectCargoDependencies(document.data, document.path, issues),
  };
}

function packageValue(
  path: string,
  pkg: Record<string, unknown>,
  key: string,
  issues: MetadataIssue[],
): unknown {
  if (!Object.hasOwn(pkg, key)) return undefined;
  const value = pkg[key];
  if (typeof value !== "string") {
    issues.push(issue(path, `package.${key}`, "unsupported", `package.${key} must be a string.`));
    return undefined;
  }
  return value;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readCargoWorkspace(
  document: ParsedDocument,
  issues: MetadataIssue[],
): WorkspaceConfig | null {
  if (!isRecord(document.data) || !Object.hasOwn(document.data, "workspace")) return null;
  const workspace = document.data.workspace;
  if (!isRecord(workspace)) {
    issues.push(
      issue(document.path, "workspace", "malformed", "Cargo.toml#workspace must be a table."),
    );
    return null;
  }
  const members = workspace.members === undefined ? [] : stringArray(workspace.members);
  const excludes = workspace.exclude === undefined ? [] : stringArray(workspace.exclude);
  if (!members) {
    issues.push(
      issue(
        document.path,
        "workspace.members",
        "unsupported",
        "workspace.members must be strings.",
      ),
    );
  }
  if (!excludes) {
    issues.push(
      issue(
        document.path,
        "workspace.exclude",
        "unsupported",
        "workspace.exclude must be strings.",
      ),
    );
  }
  if (!members || !excludes) return null;
  return {
    kind: "cargo-workspace",
    manifestPath: document.path,
    directory: document.directory,
    field: "workspace.members",
    patterns: members,
    excludeField: workspace.exclude === undefined ? null : "workspace.exclude",
    excludes,
  };
}

function collectCargoDependencies(
  manifest: Record<string, unknown>,
  manifestPath: string,
  issues: MetadataIssue[],
): DeclaredDependency[] {
  const dependencies: DeclaredDependency[] = [];
  const sink = { manifestPath, dependencies, issues };
  for (const field of DEPENDENCY_FIELDS) {
    appendDependencyTable(manifest, field, field, sink);
  }
  appendTargetDependencies(manifest, sink);
  if (isRecord(manifest.workspace)) {
    appendDependencyTable(manifest.workspace, "dependencies", "workspace.dependencies", sink);
  }
  return dependencies;
}

interface CargoDependencySink {
  readonly manifestPath: string;
  readonly dependencies: DeclaredDependency[];
  readonly issues: MetadataIssue[];
}

function appendTargetDependencies(
  manifest: Record<string, unknown>,
  sink: CargoDependencySink,
): void {
  if (!isRecord(manifest.target)) return;
  for (const target of Object.keys(manifest.target).sort((left, right) =>
    left.localeCompare(right),
  )) {
    const value = manifest.target[target];
    if (!isRecord(value)) continue;
    for (const field of DEPENDENCY_FIELDS) {
      appendDependencyTable(value, field, `${childField("target", target)}.${field}`, sink);
    }
  }
}

function appendDependencyTable(
  owner: Record<string, unknown>,
  key: string,
  field: string,
  sink: CargoDependencySink,
): void {
  if (!Object.hasOwn(owner, key)) return;
  const table = owner[key];
  if (!isRecord(table)) {
    sink.issues.push(
      issue(sink.manifestPath, field, "unsupported", `${field} must be a dependency table.`),
    );
    return;
  }
  for (const name of Object.keys(table).sort((left, right) => left.localeCompare(right))) {
    const value = table[name];
    sink.dependencies.push({ field, name, value });
    if (isRecord(value) && value.workspace === true) {
      sink.issues.push(
        issue(
          sink.manifestPath,
          childField(field, name),
          "inherited",
          "Workspace-inherited dependency values are not resolved.",
        ),
      );
    }
  }
}

function collectCargoPaths(
  manifest: Record<string, unknown>,
  manifestPath: string,
  issues: MetadataIssue[],
): DeclaredPath[] {
  const paths: DeclaredPath[] = [];
  const sink = { manifestPath, paths, issues };
  appendPath(manifest.lib, "lib.path", "path", sink);
  appendPath(manifest.package, "package.build", "build", sink);
  if (!Array.isArray(manifest.bin)) return paths;
  for (const [index, bin] of manifest.bin.entries()) {
    appendPath(bin, `bin[${index}].path`, "path", sink);
  }
  return paths;
}

interface CargoPathSink {
  readonly manifestPath: string;
  readonly paths: DeclaredPath[];
  readonly issues: MetadataIssue[];
}

function appendPath(owner: unknown, field: string, key: string, sink: CargoPathSink): void {
  if (!isRecord(owner) || !Object.hasOwn(owner, key)) return;
  const value = stringValue(owner[key]);
  if (value === null) {
    sink.issues.push(issue(sink.manifestPath, field, "unsupported", `${field} must be a string.`));
    return;
  }
  sink.paths.push({ field, path: value });
}
