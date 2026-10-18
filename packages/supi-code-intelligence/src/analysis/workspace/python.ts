/** pyproject.toml [project] declaration reader. */

import type { DocumentContribution, ParsedDocument } from "./metadata-types.ts";
import { baseProject, isRecord, issue, stringArray, stringValue } from "./metadata-utils.ts";
import type { DeclaredDependency, MetadataIssue } from "./types.ts";

const REQUIREMENT_NAME = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/;
const DYNAMIC_FIELDS = new Set(["name", "description", "dependencies", "optional-dependencies"]);

/** Read only explicitly declared `[project]` facts from one pyproject.toml. */
export function readPythonDocument(document: ParsedDocument): DocumentContribution {
  if (!isRecord(document.data)) {
    return {
      project: null,
      workspace: null,
      issues: [
        issue(document.path, null, "malformed", "pyproject.toml must contain a TOML table."),
      ],
    };
  }
  if (!Object.hasOwn(document.data, "project")) {
    return { project: null, workspace: null, issues: [] };
  }
  const project = document.data.project;
  if (!isRecord(project)) {
    return {
      project: null,
      workspace: null,
      issues: [
        issue(document.path, "project", "malformed", "pyproject.toml#project must be a table."),
      ],
    };
  }
  const issues: MetadataIssue[] = [];
  const context = { path: document.path, issues };
  const name = readStringField(context, project, "name", "project.name");
  const description = readStringField(context, project, "description", "project.description");
  recordDynamicFields(document.path, project, issues);
  return {
    project: {
      ...baseProject({
        manifestPath: document.path,
        kind: "python-project",
        directory: document.directory,
        name,
        nameField: name === null ? null : "project.name",
        description,
        descriptionField: description === null ? null : "project.description",
      }),
      dependencies: collectPythonDependencies(document.path, project, issues),
    },
    workspace: null,
    issues,
  };
}

interface PythonContext {
  readonly path: string;
  readonly issues: MetadataIssue[];
}

function readStringField(
  context: PythonContext,
  project: Record<string, unknown>,
  key: string,
  field: string,
): string | null {
  if (!Object.hasOwn(project, key)) return null;
  const value = stringValue(project[key]);
  if (value === null) {
    context.issues.push(issue(context.path, field, "unsupported", `${field} must be a string.`));
  }
  return value;
}

function recordDynamicFields(
  path: string,
  project: Record<string, unknown>,
  issues: MetadataIssue[],
): void {
  if (!Object.hasOwn(project, "dynamic")) return;
  const dynamic = stringArray(project.dynamic);
  if (!dynamic) {
    issues.push(
      issue(path, "project.dynamic", "unsupported", "project.dynamic must be a string array."),
    );
    return;
  }
  for (const field of dynamic) {
    if (!DYNAMIC_FIELDS.has(field)) continue;
    issues.push(
      issue(
        path,
        "project.dynamic",
        "dynamic",
        `project.${field} is dynamic and is not resolved from static metadata.`,
      ),
    );
  }
}

function collectPythonDependencies(
  path: string,
  project: Record<string, unknown>,
  issues: MetadataIssue[],
): DeclaredDependency[] {
  const dependencies: DeclaredDependency[] = [];
  const sink = { path, dependencies, issues };
  appendRequirementList(project, "dependencies", "project.dependencies", sink);
  if (!Object.hasOwn(project, "optional-dependencies")) return dependencies;
  const optional = project["optional-dependencies"];
  if (!isRecord(optional)) {
    issues.push(
      issue(
        path,
        "project.optional-dependencies",
        "unsupported",
        "project.optional-dependencies must be a table of requirement arrays.",
      ),
    );
    return dependencies;
  }
  for (const group of Object.keys(optional).sort((left, right) => left.localeCompare(right))) {
    appendRequirementList(optional, group, `project.optional-dependencies.${group}`, sink);
  }
  return dependencies;
}

interface DependencySink extends PythonContext {
  readonly dependencies: DeclaredDependency[];
}

function appendRequirementList(
  owner: Record<string, unknown>,
  key: string,
  field: string,
  sink: DependencySink,
): void {
  if (!Object.hasOwn(owner, key)) return;
  const values = owner[key];
  if (!Array.isArray(values)) {
    sink.issues.push(
      issue(sink.path, field, "unsupported", `${field} must be a requirement array.`),
    );
    return;
  }
  for (const value of values) {
    const requirement = stringValue(value);
    const name = requirement === null ? null : (REQUIREMENT_NAME.exec(requirement)?.[1] ?? null);
    if (requirement === null || name === null) {
      sink.issues.push(
        issue(sink.path, field, "unsupported", "Unreadable dependency requirement entry."),
      );
      continue;
    }
    sink.dependencies.push({ field, name, value: requirement });
  }
}
