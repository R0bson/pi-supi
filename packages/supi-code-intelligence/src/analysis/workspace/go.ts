/** go.mod and go.work supported-directive readers. */

import type { GoDirective, GoParseIssue } from "./go-parser.ts";
import { parseGoFile } from "./go-parser.ts";
import type { DocumentContribution, ParsedDocument, WorkspaceConfig } from "./metadata-types.ts";
import { baseProject, issue } from "./metadata-utils.ts";
import type { DeclaredDependency, MetadataIssue, ProjectDeclaration } from "./types.ts";

const GO_MOD_KNOWN = new Set([
  "module",
  "go",
  "toolchain",
  "require",
  "replace",
  "exclude",
  "retract",
  "tool",
  "godebug",
  "ignore",
]);
const GO_WORK_KNOWN = new Set(["go", "toolchain", "use", "replace", "godebug"]);

/** Read one go.mod or go.work document with grammar-aware directive parsing. */
export function readGoDocument(document: ParsedDocument): DocumentContribution {
  if (document.kind !== "go-mod" && document.kind !== "go-work") {
    return { project: null, workspace: null, issues: [] };
  }
  if (typeof document.data !== "string") {
    return {
      project: null,
      workspace: null,
      issues: [issue(document.path, null, "malformed", "Go metadata must be text.")],
    };
  }
  const parsed = parseGoFile(document.data);
  const issues = parsed.issues.map((entry) => parseIssue(document.path, entry));
  if (document.kind === "go-work") return readGoWork(document, parsed.directives, issues);
  return readGoModule(document, parsed.directives, issues);
}

function readGoModule(
  document: ParsedDocument,
  directives: readonly GoDirective[],
  issues: MetadataIssue[],
): DocumentContribution {
  const module = directives.find((directive) => directive.name === "module");
  if (module?.args.length !== 1) {
    issues.push(
      issue(
        document.path,
        "module",
        "malformed",
        module ? "module directive requires exactly one path." : "go.mod has no module directive.",
      ),
    );
  }
  const dependencies: DeclaredDependency[] = [];
  for (const directive of directives) {
    if (directive.name === "require") {
      appendGoRequirement(document.path, directive, dependencies, issues);
      continue;
    }
    if (directive.name !== "go" && directive.name !== "toolchain" && directive.name !== "module") {
      discloseGoDirective(document.path, directive, issues, GO_MOD_KNOWN);
    }
  }
  const name = module?.args.length === 1 ? (module.args[0] ?? null) : null;
  const project: ProjectDeclaration | null =
    name === null
      ? null
      : {
          ...baseProject({
            manifestPath: document.path,
            kind: "go-module",
            directory: document.directory,
            name,
            nameField: "module",
            description: null,
            descriptionField: null,
          }),
          dependencies,
        };
  return { project, workspace: null, issues };
}

function readGoWork(
  document: ParsedDocument,
  directives: readonly GoDirective[],
  issues: MetadataIssue[],
): DocumentContribution {
  const uses: string[] = [];
  for (const directive of directives) {
    if (directive.name === "use") {
      if (directive.args.length === 1) uses.push(directive.args[0] ?? "");
      else {
        issues.push(
          issue(document.path, `use line ${directive.line}`, "malformed", "use requires one path."),
        );
      }
      continue;
    }
    if (directive.name !== "go" && directive.name !== "toolchain") {
      discloseGoDirective(document.path, directive, issues, GO_WORK_KNOWN);
    }
  }
  const workspace: WorkspaceConfig = {
    kind: "go-work",
    manifestPath: document.path,
    directory: document.directory,
    field: "use",
    patterns: uses,
    excludeField: null,
    excludes: [],
  };
  return { project: null, workspace, issues };
}

function appendGoRequirement(
  path: string,
  directive: GoDirective,
  dependencies: DeclaredDependency[],
  issues: MetadataIssue[],
): void {
  if (directive.args.length !== 2) {
    issues.push(
      issue(
        path,
        `require line ${directive.line}`,
        "malformed",
        "require needs a module path and version.",
      ),
    );
    return;
  }
  const [name, value] = directive.args;
  if (!name || !value) return;
  dependencies.push({ field: "require", name, value });
}

function discloseGoDirective(
  path: string,
  directive: GoDirective,
  issues: MetadataIssue[],
  known: ReadonlySet<string>,
): void {
  const reason = known.has(directive.name)
    ? `${directive.name} is parsed but not converted into a project fact.`
    : `Unsupported Go directive: ${directive.name}.`;
  issues.push(issue(path, directive.name, "unsupported", reason));
}

function parseIssue(path: string, issueValue: GoParseIssue): MetadataIssue {
  return issue(path, `line ${issueValue.line}`, "malformed", issueValue.reason);
}
