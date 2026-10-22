import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { checkAdvisorAbort } from "./cancellation.ts";

/** Conservative gitignore rule: negations never re-include excluded files. */
export interface AdvisorIgnoreRule {
  base: string;
  pattern: string;
}

function parseRules(body: string, directory: string): AdvisorIgnoreRule[] {
  const rules: AdvisorIgnoreRule[] = [];
  for (let pattern of body.split(/\r?\n/)) {
    pattern = pattern.trim();
    if (!pattern || pattern.startsWith("#") || pattern.startsWith("!")) continue;
    // Reject unsupported escapes rather than accidentally allow a protected path.
    if (pattern.includes("\\")) throw new Error("Unsupported ignore pattern.");
    rules.push({ base: directory, pattern });
  }
  return rules;
}

async function readIgnore(file: string, signal: AbortSignal): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    checkAdvisorAbort(signal);
    const canonical = await realpath(file);
    checkAdvisorAbort(signal);
    if (canonical !== file) throw new Error("Unsafe ignore file.");
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    checkAdvisorAbort(signal);
    const stat = await handle.stat();
    checkAdvisorAbort(signal);
    if (!stat.isFile() || stat.size > 32000) throw new Error("Unsafe ignore file.");
    const buffer = Buffer.alloc(32001);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    checkAdvisorAbort(signal);
    if (bytesRead > 32000) throw new Error("Ignore file too large.");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return "";
    // biome-ignore lint/style/useErrorCause: avoid leaking OS paths or caller abort reason.
    throw new Error("Project ignore rules unavailable.");
  } finally {
    await handle?.close();
  }
}

/** Worktrees store shared info/exclude in the common git directory, not beneath cwd/.git. */
async function worktreeExcludes(directory: string, signal: AbortSignal): Promise<string> {
  const dotgit = join(directory, ".git");
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(dotgit);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    // biome-ignore lint/style/useErrorCause: filesystem error causes may contain sensitive paths.
    throw new Error("Git ignore metadata unavailable.");
  }
  checkAdvisorAbort(signal);
  if (stat.isDirectory()) return "";
  if (!stat.isFile()) throw new Error("Unsafe git ignore metadata.");
  const pointer = await readIgnore(dotgit, signal);
  const match = /^gitdir: ([^\r\n]+)\s*$/.exec(pointer);
  if (!match) throw new Error("Invalid git ignore metadata.");
  const gitdir = resolve(directory, match[1]);
  const common = (await readIgnore(join(gitdir, "commondir"), signal)).trim();
  const commonDir = common ? resolve(gitdir, common) : gitdir;
  return await readIgnore(join(commonDir, "info", "exclude"), signal);
}

/** Read local ignore sources only; never spawn git or inherit its executable configuration. */
export async function readAdvisorIgnoreRules(
  directory: string,
  signal: AbortSignal,
): Promise<AdvisorIgnoreRule[]> {
  const gitignore = await readIgnore(join(directory, ".gitignore"), signal);
  const exclude = await readIgnore(join(directory, ".git", "info", "exclude"), signal);
  const worktree = await worktreeExcludes(directory, signal);
  return [
    ...parseRules(gitignore, directory),
    ...parseRules(exclude, directory),
    ...parseRules(worktree, directory),
  ];
}

/** Linear-space wildcard matching: no backtracking regex on untrusted ignore patterns. */
function segmentMatch(text: string, pattern: string): boolean {
  let row = Array.from({ length: text.length + 1 }, (_, i) => i === 0);
  for (const token of pattern) {
    const next = new Array<boolean>(text.length + 1).fill(false);
    next[0] = token === "*" && row[0];
    for (let i = 1; i <= text.length; i++) {
      next[i] =
        token === "*"
          ? row[i] || next[i - 1]
          : row[i - 1] && (token === "?" || token === text[i - 1]);
    }
    row = next;
  }
  return row[text.length];
}

/** Git wildcards match leading dots; a whole ** component also spans directories. */
function matchesIgnoreGlob(path: string, pattern: string): boolean {
  if (pattern.length > 512 || pattern.includes("[")) throw new Error("Unsupported ignore pattern.");
  const parts = path.split("/");
  let row = Array.from({ length: parts.length + 1 }, (_, i) => i === 0);
  for (const token of pattern.split("/")) {
    const next = new Array<boolean>(parts.length + 1).fill(false);
    next[0] = token === "**" && row[0];
    for (let i = 1; i <= parts.length; i++) {
      next[i] =
        token === "**" ? row[i] || next[i - 1] : row[i - 1] && segmentMatch(parts[i - 1], token);
    }
    row = next;
  }
  return row[parts.length];
}

/** Match every path prefix so ignored directories also protect their descendants. */
export function advisorIgnored(path: string, rule: AdvisorIgnoreRule): boolean {
  const rel = relative(rule.base, path).split(sep).join("/");
  const pattern = rule.pattern.replace(/^\//, "").replace(/\/$/, "");
  const parts = rel.split("/");
  if (pattern.includes("/") || rule.pattern.startsWith("/")) {
    return parts.some((_, index) =>
      matchesIgnoreGlob(parts.slice(0, index + 1).join("/"), pattern),
    );
  }
  return parts.some((part) => matchesIgnoreGlob(part, pattern));
}
