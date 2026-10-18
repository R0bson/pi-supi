/** package.json and Node workspace declaration readers. */

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

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/** Read one package.json or pnpm-workspace.yaml document. */
export function readNodeDocument(document: ParsedDocument): DocumentContribution {
  if (document.kind === "pnpm-workspace") return readPnpmWorkspace(document);
  if (!isRecord(document.data)) {
    return {
      project: null,
      workspace: null,
      issues: [issue(document.path, null, "malformed", "package.json must contain an object.")],
    };
  }
  const issues: MetadataIssue[] = [];
  const project = baseProject({
    manifestPath: document.path,
    kind: "node-package",
    directory: document.directory,
    name: stringValue(document.data.name),
    nameField: stringValue(document.data.name) === null ? null : "name",
    description: stringValue(document.data.description),
    descriptionField: stringValue(document.data.description) === null ? null : "description",
  });
  return {
    project: {
      ...project,
      declaredPaths: collectNodePaths(document.data, document.path, issues),
      dependencies: collectNodeDependencies(document.data, document.path, issues),
    },
    workspace: readPackageWorkspaces(document, issues),
    issues,
  };
}

function readPnpmWorkspace(document: ParsedDocument): DocumentContribution {
  if (!isRecord(document.data)) {
    return {
      project: null,
      workspace: null,
      issues: [
        issue(document.path, null, "malformed", "pnpm-workspace.yaml must contain a mapping."),
      ],
    };
  }
  if (!Object.hasOwn(document.data, "packages")) {
    return { project: null, workspace: null, issues: [] };
  }
  const patterns = stringArray(document.data.packages);
  if (!patterns) {
    return {
      project: null,
      workspace: null,
      issues: [
        issue(
          document.path,
          "packages",
          "unsupported",
          "pnpm-workspace.yaml#packages must be a string array.",
        ),
      ],
    };
  }
  return {
    project: null,
    workspace: {
      kind: "node-workspace",
      manifestPath: document.path,
      directory: document.directory,
      field: "packages",
      patterns,
      excludeField: null,
      excludes: [],
    },
    issues: [],
  };
}

function readPackageWorkspaces(
  document: ParsedDocument,
  issues: MetadataIssue[],
): WorkspaceConfig | null {
  if (!isRecord(document.data) || !Object.hasOwn(document.data, "workspaces")) return null;
  const workspaces = document.data.workspaces;
  const patterns = Array.isArray(workspaces)
    ? stringArray(workspaces)
    : isRecord(workspaces) && Array.isArray(workspaces.packages)
      ? stringArray(workspaces.packages)
      : null;
  if (!patterns) {
    issues.push(
      issue(
        document.path,
        Array.isArray(workspaces) ? "workspaces" : "workspaces.packages",
        "unsupported",
        "Workspace membership must be a string array or an object with a string packages array.",
      ),
    );
    return null;
  }
  return {
    kind: "node-workspace",
    manifestPath: document.path,
    directory: document.directory,
    field: Array.isArray(workspaces) ? "workspaces" : "workspaces.packages",
    patterns,
    excludeField: null,
    excludes: [],
  };
}

function collectNodeDependencies(
  manifest: Record<string, unknown>,
  manifestPath: string,
  issues: MetadataIssue[],
): DeclaredDependency[] {
  const dependencies: DeclaredDependency[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    if (!Object.hasOwn(manifest, field)) continue;
    const value = manifest[field];
    if (!isRecord(value)) {
      issues.push(issue(manifestPath, field, "unsupported", `${field} must be an object.`));
      continue;
    }
    for (const name of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
      dependencies.push({ field, name, value: value[name] });
    }
  }
  return dependencies;
}

function collectNodePaths(
  manifest: Record<string, unknown>,
  manifestPath: string,
  issues: MetadataIssue[],
): DeclaredPath[] {
  const paths: DeclaredPath[] = [];
  for (const field of ["main", "module", "browser", "types", "typings"] as const) {
    const value = stringValue(manifest[field]);
    if (value !== null) paths.push({ field, path: value });
  }
  if (Object.hasOwn(manifest, "exports")) {
    appendExportPaths(manifest.exports, "exports", paths);
  }
  appendBinPaths(manifest.bin, paths);
  appendPiExtensionPaths(manifest.pi, manifestPath, paths, issues);
  return paths;
}

function appendExportPaths(value: unknown, field: string, paths: DeclaredPath[]): void {
  const direct = stringValue(value);
  if (direct !== null) {
    paths.push({ field, path: direct });
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      appendExportPaths(entry, `${field}[${index}]`, paths);
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    appendExportPaths(value[key], childField(field, key), paths);
  }
}

function appendBinPaths(value: unknown, paths: DeclaredPath[]): void {
  const direct = stringValue(value);
  if (direct !== null) {
    paths.push({ field: "bin", path: direct });
    return;
  }
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    const entry = stringValue(value[key]);
    if (entry !== null) paths.push({ field: childField("bin", key), path: entry });
  }
}

function appendPiExtensionPaths(
  value: unknown,
  manifestPath: string,
  paths: DeclaredPath[],
  issues: MetadataIssue[],
): void {
  if (!isRecord(value) || !Object.hasOwn(value, "extensions")) return;
  const replacements = stringArray(value.extensions);
  if (!replacements) {
    issues.push(
      issue(manifestPath, "pi.extensions", "unsupported", "pi.extensions must be a string array."),
    );
    return;
  }
  for (const [index, entry] of replacements.entries()) {
    paths.push({ field: `pi.extensions[${index}]`, path: entry });
  }
}
