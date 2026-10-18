/** Small value helpers shared by metadata readers. */

import type { MetadataIssue, MetadataIssueKind, ProjectDeclaration } from "./types.ts";

/** Check for a plain parsed object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a string value without coercing other types. */
export function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Read an array of strings, or null when any entry is not a string. */
export function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((entry) => typeof entry === "string") ? [...value] : null;
}

/** Create one documented metadata issue. */
export function issue(
  path: string,
  field: string | null,
  kind: MetadataIssueKind,
  reason: string,
): MetadataIssue {
  return { path, field, kind, reason };
}

/** Create an empty project with the stable manifest-path identity. */
export function baseProject(input: {
  manifestPath: string;
  kind: ProjectDeclaration["kind"];
  directory: string;
  name: string | null;
  nameField: string | null;
  description: string | null;
  descriptionField: string | null;
}): ProjectDeclaration {
  return {
    id: input.manifestPath,
    manifestPath: input.manifestPath,
    kind: input.kind,
    directory: input.directory,
    name: input.name,
    nameField: input.nameField,
    description: input.description,
    descriptionField: input.descriptionField,
    memberships: [],
    declaredPaths: [],
    dependencies: [],
  };
}

/** Join a parent field and a child key while retaining the exact key text. */
export function childField(parent: string, key: string): string {
  if (/^[A-Za-z_$][\w$]*$/.test(key)) return `${parent}.${key}`;
  return `${parent}[${JSON.stringify(key)}]`;
}
