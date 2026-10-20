import * as path from "node:path";
import picomatch from "picomatch";

/** Language selected for a C-family source file. */
export type CFamilyLanguage = "c" | "cpp";

/** One ordered, project-relative language rule for an existing C-family file. */
export interface CFamilyFileAssociationRule {
  readonly pattern: string;
  readonly language: CFamilyLanguage;
}

/** C-family suffixes that already have Tree-sitter and LSP support. */
export const C_FAMILY_EXTENSIONS = Object.freeze([
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".cxx",
  ".hxx",
  ".c++",
  ".h++",
] as const);

export type CFamilyExtension = (typeof C_FAMILY_EXTENSIONS)[number];

const DEFAULT_C_FAMILY_LANGUAGES: Readonly<Record<CFamilyExtension, CFamilyLanguage>> =
  Object.freeze({
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".hxx": "cpp",
    ".c++": "cpp",
    ".h++": "cpp",
  });

/** Immutable C-family language selection for one workspace. */
export interface CFamilyFileAssociationResolver {
  /** Absolute root used to make project-relative paths. */
  readonly workspaceRoot: string;
  /** Validated ordered rules captured when the workspace host starts. */
  readonly rules: readonly CFamilyFileAssociationRule[];
  /** Select the configured language or the existing suffix default. */
  languageForFile(filePath: string): CFamilyLanguage | undefined;
}

/** Return the current default language for one supported C-family suffix. */
export function defaultCFamilyLanguage(extension: string): CFamilyLanguage | undefined {
  return DEFAULT_C_FAMILY_LANGUAGES[extension.toLowerCase() as CFamilyExtension];
}

/**
 * Validate and compile ordered C-family file associations for one workspace.
 * Patterns are case-sensitive globs over POSIX-style, workspace-relative paths.
 * Supported patterns use `*`, `?`, `**`, character classes, and brace alternatives.
 * The first matching rule wins. Rules never expand the eligible suffix set.
 *
 * @throws If the rule list, a rule, a language, or a pattern is invalid.
 */
export function createCFamilyFileAssociationResolver(
  workspaceRoot: string,
  input: unknown = [],
): CFamilyFileAssociationResolver {
  const rules = validateRules(input);
  const matchers = rules.map((rule, index) => ({
    language: rule.language,
    matches: compilePattern(rule.pattern, `code-intelligence.fileAssociations[${index}]`),
  }));
  const root = path.resolve(workspaceRoot);
  return Object.freeze({
    workspaceRoot: root,
    rules,
    languageForFile(filePath: string): CFamilyLanguage | undefined {
      const extension = normalizeExtension(filePath);
      const fallback = defaultCFamilyLanguage(extension);
      if (!fallback) return undefined;

      const absolutePath = path.resolve(root, filePath);
      const relativePath = toPosixPath(path.relative(root, absolutePath));
      if (
        relativePath === ".." ||
        relativePath.startsWith("../") ||
        path.posix.isAbsolute(relativePath)
      ) {
        return fallback;
      }
      for (const rule of matchers) {
        if (rule.matches(relativePath)) return rule.language;
      }
      return fallback;
    },
  });
}

function validateRules(input: unknown): readonly CFamilyFileAssociationRule[] {
  if (!Array.isArray(input)) {
    throw new Error('Invalid "code-intelligence.fileAssociations": expected an ordered array.');
  }
  if (input.length > 64) {
    throw new Error('Invalid "code-intelligence.fileAssociations": use no more than 64 rules.');
  }
  const rules: CFamilyFileAssociationRule[] = [];
  const seenPatterns = new Set<string>();
  for (const [index, value] of input.entries()) {
    const key = `code-intelligence.fileAssociations[${index}]`;
    if (!isRecord(value) || !hasExactKeys(value, ["pattern", "language"])) {
      throw new Error(`${key} must contain only "pattern" and "language" fields.`);
    }
    if (typeof value.pattern !== "string") {
      throw new Error(`${key}.pattern must be a string.`);
    }
    if (value.language !== "c" && value.language !== "cpp") {
      throw new Error(`${key}.language must be "c" or "cpp".`);
    }
    if (seenPatterns.has(value.pattern)) {
      throw new Error(`${key}.pattern duplicates an earlier rule.`);
    }
    seenPatterns.add(value.pattern);
    rules.push(Object.freeze({ pattern: value.pattern, language: value.language }));
  }
  return Object.freeze(rules);
}

function compilePattern(pattern: string, key: string): (file: string) => boolean {
  if (
    pattern.length === 0 ||
    pattern.length > 512 ||
    pattern !== pattern.trim() ||
    pattern.includes("\\") ||
    hasControlCharacter(pattern) ||
    pattern.startsWith("/") ||
    /^[A-Za-z]:/.test(pattern) ||
    pattern.startsWith("!")
  ) {
    throw new Error(`${key}.pattern must be a safe workspace-relative glob using "/" separators.`);
  }
  const segments = pattern.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${key}.pattern contains an unsafe or unsupported path pattern.`);
  }
  try {
    return picomatch(pattern, {
      nocase: false,
      windows: false,
      dot: true,
      strictBrackets: true,
      nonegate: true,
      noextglob: true,
      maxLength: 512,
    });
  } catch (error) {
    throw new Error(`${key}.pattern is not a valid glob: ${errorMessage(error)}`, { cause: error });
  }
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function normalizeExtension(filePath: string): string {
  return path.posix.extname(toPosixPath(filePath)).toLowerCase();
}

function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return (
    keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
