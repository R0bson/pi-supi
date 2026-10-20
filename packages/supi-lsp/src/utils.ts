// URI and language utilities for LSP.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type CFamilyFileAssociationResolver,
  defaultCFamilyLanguage,
} from "@mrclrchtr/supi-code-runtime/api";

// ── Language ID Detection ─────────────────────────────────────────────

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  jsx: "javascriptreact",
  mts: "typescript",
  cts: "typescript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyi: "python",
  rs: "rust",
  go: "go",
  mod: "go.mod",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  html: "html",
  htm: "html",
  xhtml: "html",
  css: "css",
  scss: "scss",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  ksh: "shellscript",
  toml: "toml",
  xml: "xml",
  sql: "sql",
  r: "r",
  rb: "ruby",
  erb: "erb",
  gemspec: "ruby",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  lua: "lua",
  tex: "latex",
  bib: "bibtex",
  zig: "zig",
};

/** Detect the LSP languageId from a file path and optional workspace snapshot. */
export function detectLanguageId(
  filePath: string,
  associations?: CFamilyFileAssociationResolver,
): string {
  const cFamilyLanguage =
    associations?.languageForFile(filePath) ?? defaultCFamilyLanguage(path.extname(filePath));
  if (cFamilyLanguage) return cFamilyLanguage;
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return EXT_TO_LANGUAGE[ext] ?? ext;
}

// ── PATH Validation ───────────────────────────────────────────────────

/**
 * Check if a command exists on PATH.
 * Uses synchronous check to avoid complexity.
 */
export function commandExists(command: string): boolean {
  // If it is an absolute path, validate the exact executable file.
  if (path.isAbsolute(command)) {
    return isExecutableFile(command);
  }

  const pathDirs = (process.env.PATH ?? "").split(path.delimiter);
  const extensions =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];

  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const fullPath = path.join(dir, command + ext);
      if (isExecutableFile(fullPath)) return true;
    }
  }
  return false;
}

function isExecutableFile(filePath: string): boolean {
  try {
    if (!fs.statSync(filePath).isFile()) return false;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
