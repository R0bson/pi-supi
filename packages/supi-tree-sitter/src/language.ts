// Language detection and grammar resolution for Tree-sitter.
//
// All grammar WASM files are vendored in resources/grammars/<id>/ and
// shipped with the package. No runtime require.resolve() to third-party
// npm packages is needed.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  C_FAMILY_EXTENSIONS,
  type CFamilyExtension,
  type CFamilyFileAssociationResolver,
  defaultCFamilyLanguage,
} from "@mrclrchtr/supi-code-runtime/api";
import type { GrammarId, SupportedExtension } from "./types.ts";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const C_FAMILY_GRAMMAR = Object.fromEntries(
  C_FAMILY_EXTENSIONS.map((extension) => [extension, defaultCFamilyLanguage(extension)]),
) as Record<CFamilyExtension, GrammarId>;

/** Mapping from file extension to grammar identifier. */
const EXTENSION_GRAMMAR = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".py": "python",
  ".pyi": "python",
  ".rs": "rust",
  ".go": "go",
  ...C_FAMILY_GRAMMAR,
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".rb": "ruby",
  ".gemspec": "ruby",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".ksh": "bash",
  ".html": "html",
  ".htm": "html",
  ".xhtml": "html",
  ".r": "r",
  ".sql": "sql",
  ".tex": "latex",
  ".sty": "latex",
  ".cls": "latex",
} satisfies Record<SupportedExtension, GrammarId>;

const SUPPORTED_EXTENSIONS = Object.keys(EXTENSION_GRAMMAR) as SupportedExtension[];

/** Return all supported file extensions (with leading dot). */
export function getSupportedExtensions(): SupportedExtension[] {
  return [...SUPPORTED_EXTENSIONS];
}

/** Internal registry snapshot used to derive operation-specific language support. */
export function getSupportedExtensionGrammarEntries(): Array<
  readonly [SupportedExtension, GrammarId]
> {
  return Object.entries(EXTENSION_GRAMMAR) as Array<readonly [SupportedExtension, GrammarId]>;
}

/** Detect the grammar for a file. Returns undefined if unsupported. */
export function detectGrammar(
  filePath: string,
  associations?: CFamilyFileAssociationResolver,
): GrammarId | undefined {
  const familyLanguage = associations?.languageForFile(filePath);
  if (familyLanguage) return familyLanguage;
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_GRAMMAR[ext as SupportedExtension];
}

/** Grammar WASM file names within the vendored resources directory. */
const GRAMMAR_WASM: Record<GrammarId, string> = {
  javascript: "tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  python: "tree-sitter-python.wasm",
  rust: "tree-sitter-rust.wasm",
  go: "tree-sitter-go.wasm",
  c: "tree-sitter-c.wasm",
  cpp: "tree-sitter-cpp.wasm",
  java: "tree-sitter-java.wasm",
  kotlin: "tree-sitter-kotlin.wasm",
  ruby: "tree-sitter-ruby.wasm",
  bash: "tree-sitter-bash.wasm",
  html: "tree-sitter-html.wasm",
  r: "tree-sitter-r.wasm",
  sql: "tree-sitter-sql.wasm",
  latex: "tree-sitter-latex.wasm",
};

const resourcesDir = path.resolve(sourceDir, "../resources/grammars");

/**
 * Resolve the WASM grammar file path for a given grammar ID.
 * All grammars use vendored WASM files under `resources/grammars/<id>/`.
 */
export function resolveGrammarWasmPath(grammarId: GrammarId): string {
  const wasmFile = GRAMMAR_WASM[grammarId];
  const vendoredPath = path.join(resourcesDir, grammarId, wasmFile);

  // Verify the vendored file exists at init time — fail fast if missing
  if (!fs.existsSync(vendoredPath)) {
    throw new Error(
      `Vendored WASM grammar not found for "${grammarId}": expected at ${vendoredPath}. ` +
        "Run `pnpm --filter @mrclrchtr/supi-tree-sitter generate:all-wasm` or reinstall the package.",
    );
  }

  return vendoredPath;
}
