/** Declared local project relationships from uniquely identified native project names. */

import { isRecord, stringValue } from "./metadata-utils.ts";
import type {
  DeclaredDependency,
  ProjectDeclaration,
  ProjectKind,
  ProjectRelationship,
} from "./types.ts";

type ProjectIndex = Map<ProjectKind, Map<string, ProjectDeclaration[]>>;

/** Build declarations only for targets with exactly one established project identity. */
export function buildRelationships(projects: readonly ProjectDeclaration[]): ProjectRelationship[] {
  const index = indexProjects(projects);
  const relationships: ProjectRelationship[] = [];
  for (const project of projects) {
    for (const dependency of project.dependencies) {
      const target = resolveTarget(project, dependency, index);
      if (!target) continue;
      relationships.push({
        from: project.id,
        to: target.id,
        manifestPath: project.manifestPath,
        field: dependency.field,
        value: dependency.value,
      });
    }
  }
  return sortRelationships(relationships);
}

function indexProjects(projects: readonly ProjectDeclaration[]): ProjectIndex {
  const index: ProjectIndex = new Map();
  for (const project of projects) {
    const key = identityKey(project);
    if (key === null) continue;
    const byKind = index.get(project.kind) ?? new Map<string, ProjectDeclaration[]>();
    const entries = byKind.get(key) ?? [];
    entries.push(project);
    byKind.set(key, entries);
    index.set(project.kind, byKind);
  }
  return index;
}

function identityKey(project: ProjectDeclaration): string | null {
  if (project.name === null) return null;
  return project.kind === "python-project" ? normalizePythonName(project.name) : project.name;
}

function resolveTarget(
  project: ProjectDeclaration,
  dependency: DeclaredDependency,
  index: ProjectIndex,
): ProjectDeclaration | null {
  const key = dependencyKey(project.kind, dependency);
  if (key === null) return null;
  const entries = index.get(project.kind)?.get(key) ?? [];
  return entries.length === 1 ? (entries[0] ?? null) : null;
}

function dependencyKey(kind: ProjectKind, dependency: DeclaredDependency): string | null {
  if (kind === "python-project") return normalizePythonName(dependency.name);
  if (kind === "rust-package") return rustDependencyKey(dependency);
  return dependency.name;
}

function rustDependencyKey(dependency: DeclaredDependency): string | null {
  if (!isRecord(dependency.value)) return dependency.name;
  if (dependency.value.workspace === true) return null;
  return stringValue(dependency.value.package) ?? dependency.name;
}

/** Normalize only the match key; the declared name remains unchanged. */
function normalizePythonName(value: string): string {
  return value.toLowerCase().replaceAll(/[-_.]+/g, "-");
}

function sortRelationships(values: readonly ProjectRelationship[]): ProjectRelationship[] {
  return [...values].sort(
    (left, right) =>
      left.from.localeCompare(right.from) ||
      left.field.localeCompare(right.field) ||
      left.to.localeCompare(right.to),
  );
}
