/** Explicit workspace-membership resolution. Directory adjacency is never used. */

import * as path from "node:path";
import type { WorkspaceConfig } from "./metadata-types.ts";
import { issue } from "./metadata-utils.ts";
import { normalizeRelativePath } from "./paths.ts";
import type { MetadataIssue, ProjectDeclaration, ProjectMembership } from "./types.ts";

interface CompiledPattern {
  readonly value: string;
  readonly negative: boolean;
  readonly glob: string;
}

interface CompiledConfig {
  readonly config: WorkspaceConfig;
  readonly patterns: readonly CompiledPattern[];
  readonly excludes: readonly CompiledPattern[];
}

/** Attach explicit memberships to projects without inferring from directory layout. */
export function applyMemberships(
  projects: readonly ProjectDeclaration[],
  configs: readonly WorkspaceConfig[],
  issues: MetadataIssue[],
): ProjectDeclaration[] {
  const compiled = configs.map((config) => compileConfig(config, issues));
  const goMatches = new Map<string, Set<string>>();
  const result = projects.map((project) => ({
    ...project,
    memberships: membershipsForProject(project, compiled, goMatches),
  }));
  reportUnmatchedGoUses(compiled, goMatches, issues);
  return result;
}

function compileConfig(config: WorkspaceConfig, issues: MetadataIssue[]): CompiledConfig {
  return {
    config,
    patterns: compilePatterns(config, config.patterns, issues),
    excludes: compilePatterns(config, config.excludes, issues),
  };
}

function compilePatterns(
  config: WorkspaceConfig,
  values: readonly string[],
  issues: MetadataIssue[],
): CompiledPattern[] {
  const patterns: CompiledPattern[] = [];
  for (const value of values) {
    const compiled = compilePattern(config, value, issues);
    if (compiled) patterns.push(compiled);
  }
  return patterns;
}

function compilePattern(
  config: WorkspaceConfig,
  value: string,
  issues: MetadataIssue[],
): CompiledPattern | null {
  const negative = config.kind === "node-workspace" && value.startsWith("!");
  const normalized = normalizeRelativePath(negative ? value.slice(1) : value);
  if (
    normalized === null ||
    value.length === 0 ||
    (config.kind !== "go-work" &&
      (value.includes("\\") || /[?*+@!]\(/.test(value) || value.startsWith("!!")))
  ) {
    issues.push(
      issue(
        config.manifestPath,
        config.field,
        "unsupported",
        `Unsupported workspace path pattern: \`${value}\`.`,
      ),
    );
    return null;
  }
  try {
    path.matchesGlob("pattern-check", normalized);
  } catch (error) {
    issues.push(
      issue(
        config.manifestPath,
        config.field,
        "unsupported",
        `Unsupported workspace path pattern \`${value}\`: ${String(error)}`,
      ),
    );
    return null;
  }
  return { value, negative, glob: normalized };
}

function membershipsForProject(
  project: ProjectDeclaration,
  configs: readonly CompiledConfig[],
  goMatches: Map<string, Set<string>>,
): ProjectMembership[] {
  const memberships: ProjectMembership[] = [];
  for (const compiled of configs) {
    if (!supportsKind(compiled.config.kind, project.kind)) continue;
    const relative = relativeDirectory(compiled.config.directory, project.directory);
    if (relative === null) continue;
    if (compiled.config.kind === "go-work") {
      const membership = matchGoUse(compiled, project, goMatches);
      if (membership) memberships.push(membership);
      continue;
    }
    if (isExcluded(compiled, relative)) continue;
    const matched = lastMatchingPattern(compiled.patterns, relative);
    if (!matched) continue;
    memberships.push({
      kind: compiled.config.kind,
      manifestPath: compiled.config.manifestPath,
      field: compiled.config.field,
      value: matched.value,
    });
  }
  return dedupeMemberships(memberships);
}

function supportsKind(
  workspaceKind: WorkspaceConfig["kind"],
  projectKind: ProjectDeclaration["kind"],
): boolean {
  if (workspaceKind === "node-workspace") return projectKind === "node-package";
  if (workspaceKind === "cargo-workspace") return projectKind === "rust-package";
  return projectKind === "go-module";
}

function relativeDirectory(base: string, directory: string): string | null {
  const relative = path.posix.relative(base, directory);
  if (relative === "") return ".";
  if (relative === ".." || relative.startsWith("../")) return null;
  return relative;
}

function isExcluded(config: CompiledConfig, relative: string): boolean {
  return config.excludes.some((pattern) => patternMatches(pattern, relative));
}

function lastMatchingPattern(
  patterns: readonly CompiledPattern[],
  relative: string,
): CompiledPattern | null {
  let matched: CompiledPattern | null = null;
  for (const pattern of patterns) {
    if (!patternMatches(pattern, relative)) continue;
    if (pattern.negative) return null;
    matched = pattern;
  }
  return matched?.negative ? null : matched;
}

function patternMatches(pattern: CompiledPattern, relative: string): boolean {
  try {
    return path.matchesGlob(relative, pattern.glob);
  } catch {
    return false;
  }
}

function matchGoUse(
  config: CompiledConfig,
  project: ProjectDeclaration,
  goMatches: Map<string, Set<string>>,
): ProjectMembership | null {
  for (const pattern of config.patterns) {
    const usePath = normalizeRelativePath(path.posix.join(config.config.directory, pattern.glob));
    if (usePath !== project.directory) continue;
    markGoMatch(config.config.manifestPath, pattern.value, goMatches);
    return {
      kind: "go-work",
      manifestPath: config.config.manifestPath,
      field: config.config.field,
      value: pattern.value,
    };
  }
  return null;
}

function markGoMatch(manifestPath: string, value: string, matches: Map<string, Set<string>>): void {
  const values = matches.get(manifestPath) ?? new Set<string>();
  values.add(value);
  matches.set(manifestPath, values);
}

function reportUnmatchedGoUses(
  configs: readonly CompiledConfig[],
  matches: ReadonlyMap<string, Set<string>>,
  issues: MetadataIssue[],
): void {
  for (const compiled of configs) {
    if (compiled.config.kind !== "go-work") continue;
    const matched = matches.get(compiled.config.manifestPath) ?? new Set<string>();
    for (const pattern of compiled.patterns) {
      if (matched.has(pattern.value)) continue;
      issues.push(
        issue(
          compiled.config.manifestPath,
          compiled.config.field,
          "unresolved",
          `go.work use path \`${pattern.value}\` has no observed go.mod project.`,
        ),
      );
    }
  }
}

function dedupeMemberships(values: readonly ProjectMembership[]): ProjectMembership[] {
  const seen = new Set<string>();
  const result: ProjectMembership[] = [];
  for (const value of values) {
    const key = `${value.kind}\0${value.manifestPath}\0${value.field}\0${value.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
