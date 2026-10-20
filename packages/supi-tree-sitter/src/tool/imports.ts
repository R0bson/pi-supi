// Import extraction for supported files.

import type { CodeRequestControl } from "@mrclrchtr/supi-code-runtime/api";
import { nodeToRange } from "../coordinates.ts";
import { withSyntaxCompleteness } from "../syntax-errors.ts";
import type { SyntaxNodeLike } from "../syntax-node.ts";
import type { ImportRecord, TreeSitterResult } from "../types.ts";
import type { TreeSitterRuntime } from "../worker/runtime.ts";

/** Extract import records from a supported file. */
export async function extractImports(
  runtime: TreeSitterRuntime,
  filePath: string,
  control?: CodeRequestControl,
): Promise<TreeSitterResult<ImportRecord[]>> {
  const parseResult = await runtime.parseFile(filePath, control);
  if (parseResult.kind !== "success") return parseResult;

  const { tree, source } = parseResult.data;
  const imports: ImportRecord[] = [];

  try {
    switch (parseResult.data.grammarId) {
      case "latex":
        walkForLatexImports(tree.rootNode, source, imports);
        break;
      case "python":
        walkForPythonImports(tree.rootNode, source, imports);
        break;
      case "java":
        walkForJavaImports(tree.rootNode, source, imports);
        break;
      case "go":
        walkForGoImports(tree.rootNode, source, imports);
        break;
      case "rust":
        walkForRustImports(tree.rootNode, source, imports);
        break;
      case "c":
      case "cpp":
        walkForCIncludes(tree.rootNode, source, imports);
        break;
      default:
        walkForImports(tree.rootNode, source, imports);
    }
    return withSyntaxCompleteness({
      data: imports,
      file: filePath,
      root: tree.rootNode,
      source,
      grammarId: parseResult.data.grammarId,
    });
  } finally {
    tree.delete();
  }
}

function walkForImports(node: SyntaxNodeLike, source: string, imports: ImportRecord[]): void {
  if (node.type === "import_statement") {
    const sourceNode = node.childForFieldName("source");
    if (sourceNode) {
      const specifier = sourceNode.text.replace(/^["']|["']$/g, "");
      imports.push({ moduleSpecifier: specifier, range: nodeToRange(node, source) });
    }
    return;
  }
  for (const child of node.children) walkForImports(child, source, imports);
}

function walkForPythonImports(node: SyntaxNodeLike, source: string, imports: ImportRecord[]): void {
  if (node.type === "import_statement") {
    for (const child of node.children) {
      const path = pythonImportPath(child);
      if (path) imports.push({ moduleSpecifier: path, range: nodeToRange(node, source) });
    }
    return;
  }
  if (node.type === "import_from_statement") {
    const module = node.children.find(
      (child) => child.type === "relative_import" || child.type === "dotted_name",
    );
    if (module) imports.push({ moduleSpecifier: module.text, range: nodeToRange(node, source) });
    return;
  }
  for (const child of node.children) walkForPythonImports(child, source, imports);
}

function pythonImportPath(node: SyntaxNodeLike): string | null {
  if (node.type === "aliased_import") {
    const path = node.children.find(
      (child) => child.type === "dotted_name" || child.type === "identifier",
    );
    return path?.text ?? null;
  }
  return node.type === "dotted_name" || node.type === "identifier" ? node.text : null;
}

function walkForJavaImports(node: SyntaxNodeLike, source: string, imports: ImportRecord[]): void {
  if (node.type === "import_declaration") {
    const path = node.children.find(
      (child) => child.type === "scoped_identifier" || child.type === "identifier",
    );
    if (path) {
      const wildcard = node.children.some(
        (child) => child.type === "*" || child.type === "asterisk",
      );
      imports.push({
        moduleSpecifier: `${path.text}${wildcard ? ".*" : ""}`,
        range: nodeToRange(node, source),
      });
    }
    return;
  }
  for (const child of node.children) walkForJavaImports(child, source, imports);
}

function walkForGoImports(node: SyntaxNodeLike, source: string, imports: ImportRecord[]): void {
  if (node.type === "import_spec") {
    const literal = node.children.find(
      (child) => child.type === "interpreted_string_literal" || child.type === "raw_string_literal",
    );
    if (literal) {
      imports.push({
        moduleSpecifier: literalContent(literal.text),
        range: nodeToRange(node, source),
      });
    }
    return;
  }
  for (const child of node.children) walkForGoImports(child, source, imports);
}

function walkForRustImports(node: SyntaxNodeLike, source: string, imports: ImportRecord[]): void {
  if (node.type === "use_declaration") {
    const argument = node.childForFieldName("argument");
    if (argument) flattenRustUseTree(argument, "", source, imports);
    return;
  }
  if (node.type === "extern_crate_declaration") {
    const crate = node.children.find((child) => child.type === "identifier");
    if (crate) imports.push({ moduleSpecifier: crate.text, range: nodeToRange(node, source) });
    return;
  }
  if (node.type === "mod_item") {
    const body = node.childForFieldName("body");
    if (body) {
      walkForRustImports(body, source, imports);
    } else {
      const name = node.childForFieldName("name");
      if (name) imports.push({ moduleSpecifier: name.text, range: nodeToRange(node, source) });
    }
    return;
  }
  for (const child of node.children) walkForRustImports(child, source, imports);
}

function flattenRustUseTree(
  node: SyntaxNodeLike,
  prefix: string,
  source: string,
  imports: ImportRecord[],
): void {
  switch (node.type) {
    case "scoped_use_list":
      flattenRustScopedUseList(node, prefix, source, imports);
      return;
    case "use_list":
      flattenRustUseList(node, prefix, source, imports);
      return;
    case "use_as_clause":
      flattenRustUseAlias(node, prefix, source, imports);
      return;
    case "use_wildcard":
      flattenRustUseWildcard(node, prefix, source, imports);
      return;
    case "self":
      imports.push({ moduleSpecifier: prefix, range: nodeToRange(node, source) });
      return;
    default:
      if (RUST_USE_PATH_TYPES.has(node.type)) {
        imports.push({
          moduleSpecifier: appendRustPath(prefix, node.text),
          range: nodeToRange(node, source),
        });
        return;
      }
      for (const child of node.children) flattenRustUseTree(child, prefix, source, imports);
  }
}

function flattenRustScopedUseList(
  node: SyntaxNodeLike,
  prefix: string,
  source: string,
  imports: ImportRecord[],
): void {
  const group = node.children.find((child) => child.type === "use_list");
  const base = node.children.find((child) => child !== group && child.type !== "::");
  if (group) flattenRustUseTree(group, appendRustPath(prefix, base?.text ?? ""), source, imports);
}

function flattenRustUseList(
  node: SyntaxNodeLike,
  prefix: string,
  source: string,
  imports: ImportRecord[],
): void {
  for (const child of node.children) {
    if (["{", "}", ","].includes(child.type)) continue;
    if (child.type === "self") {
      imports.push({ moduleSpecifier: prefix, range: nodeToRange(child, source) });
    } else {
      flattenRustUseTree(child, prefix, source, imports);
    }
  }
}

function flattenRustUseAlias(
  node: SyntaxNodeLike,
  prefix: string,
  source: string,
  imports: ImportRecord[],
): void {
  const aliasIndex = node.children.findIndex((child) => child.type === "as");
  const pathChildren = aliasIndex < 0 ? node.children : node.children.slice(0, aliasIndex);
  const path = pathChildren.find((child) => child.type !== "::");
  if (path) flattenRustUseTree(path, prefix, source, imports);
}

function flattenRustUseWildcard(
  node: SyntaxNodeLike,
  prefix: string,
  source: string,
  imports: ImportRecord[],
): void {
  const path = node.children.find((child) => child.type !== "::" && child.type !== "*");
  const target = appendRustPath(prefix, path?.text ?? "");
  imports.push({ moduleSpecifier: `${target}::*`, range: nodeToRange(node, source) });
}

function appendRustPath(prefix: string, suffix: string): string {
  if (!prefix) return suffix;
  if (!suffix) return prefix;
  return `${prefix}::${suffix}`;
}

function walkForCIncludes(node: SyntaxNodeLike, source: string, imports: ImportRecord[]): void {
  if (node.type === "preproc_include") {
    const literal = node.children.find(
      (child) => child.type === "system_lib_string" || child.type === "string_literal",
    );
    if (literal) {
      imports.push({
        moduleSpecifier: literalContent(literal.text),
        range: nodeToRange(node, source),
      });
    }
    return;
  }
  for (const child of node.children) walkForCIncludes(child, source, imports);
}

function literalContent(value: string): string {
  return value.length >= 2 ? value.slice(1, -1) : "";
}

const RUST_USE_PATH_TYPES = new Set([
  "identifier",
  "crate",
  "self",
  "super",
  "scoped_identifier",
  "scoped_type_identifier",
]);

const LATEX_IMPORT_FIELDS: Readonly<Record<string, string>> = {
  package_include: "paths",
  class_include: "path",
  latex_include: "path",
  biblatex_include: "glob",
  bibstyle_include: "path",
  bibtex_include: "paths",
};

function walkForLatexImports(node: SyntaxNodeLike, source: string, imports: ImportRecord[]): void {
  if (node.type === "import_include") {
    const directory = groupContent(node.childForFieldName("directory"));
    const file = groupContent(node.childForFieldName("file"));
    if (directory || file) {
      const separator = directory && !directory.endsWith("/") ? "/" : "";
      imports.push({
        moduleSpecifier: `${directory}${separator}${file}`,
        range: nodeToRange(node, source),
      });
    }
    return;
  }

  const field = LATEX_IMPORT_FIELDS[node.type];
  if (field) {
    for (const moduleSpecifier of fieldValues(node, field)) {
      if (moduleSpecifier) imports.push({ moduleSpecifier, range: nodeToRange(node, source) });
    }
    return;
  }

  for (const child of node.children) {
    walkForLatexImports(child, source, imports);
  }
}

function fieldValues(node: SyntaxNodeLike, field: string): string[] {
  const value = node.childForFieldName(field);
  if (!value) return [];
  const paths = value.childrenForFieldName("path");
  if (paths.length > 0) return paths.map((path) => path.text.trim()).filter(Boolean);
  return [groupContent(value)];
}

function groupContent(node: SyntaxNodeLike | null): string {
  if (!node) return "";
  const trimmed = node.text.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed.slice(1, -1).trim() : trimmed;
}
