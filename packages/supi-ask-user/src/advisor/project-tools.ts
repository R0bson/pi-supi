import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Tool } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { checkAdvisorAbort } from "./cancellation.ts";
import { type AdvisorIgnoreRule, advisorIgnored, readAdvisorIgnoreRules } from "./ignore.ts";

const MAX_BYTES = 32000;
const MAX_ENTRIES = 1500;
const DENIED =
  /^(?:\.git|\.pi|\.ssh|\.aws|\.azure|\.config|\.gnupg|\.kube|\.npm|\.docker|\.terraform|node_modules|vendor|dist|build|coverage|\.next|\.venv|venv|secrets?|credentials?|auth|tokens?|passwords?|service[-_]account)(?:\..*)?$|^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_rsa.*|id_ed25519.*)$|\.(?:pem|key|p12|pfx|keystore|jks|sqlite3?|db|tfstate)$/i;

/** Dedicated tools only; never derived from parent tools or an AgentSession. */
export const ADVISOR_PROJECT_TOOLS: Tool[] = [
  {
    name: "advisor_read",
    description:
      "Read bounded UTF-8 project text. Returns actual read source; excludes ignored/secret paths and all symlinks.",
    parameters: Type.Object({ path: Type.String() }),
  },
  {
    name: "advisor_list",
    description:
      "List bounded project-relative files under a directory; excludes ignored/secret paths and symlinks.",
    parameters: Type.Object({ path: Type.Optional(Type.String()) }),
  },
  {
    name: "advisor_search",
    description:
      "Search a literal string in bounded local text files. Reports read sources and truncation.",
    parameters: Type.Object({
      path: Type.Optional(Type.String()),
      query: Type.String({ minLength: 1, maxLength: 200 }),
    }),
  },
];

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

/**
 * Per-run read-only boundary. Refuses all symlinks and hardlinked files, including internal ones.
 * Ignore negations deliberately cannot re-include files (conservative over-exclusion).
 * Limits cap traversal and bytes without a feature timer or child process.
 */
export class AdvisorProjectTools {
  readonly readSources = new Set<string>();
  private readonly ignores = new Map<string, AdvisorIgnoreRule[]>();
  private constructor(
    private readonly root: string,
    private readonly signal: AbortSignal,
  ) {}

  static async create(cwd: string, signal: AbortSignal): Promise<AdvisorProjectTools> {
    checkAdvisorAbort(signal);
    const root = await realpath(cwd);
    checkAdvisorAbort(signal);
    return new AdvisorProjectTools(root, signal);
  }

  private async boundary(path: string): Promise<void> {
    checkAdvisorAbort(this.signal);
    if (!inside(this.root, path)) throw new Error("Project path denied.");
    let current = this.root;
    for (const part of relative(this.root, path).split(sep).filter(Boolean)) {
      if (DENIED.test(part)) throw new Error("Project path denied.");
      current = join(current, part);
      const stat = await lstat(current);
      checkAdvisorAbort(this.signal);
      if (stat.isSymbolicLink()) throw new Error("Project path denied.");
    }
    const canonical = await realpath(path);
    checkAdvisorAbort(this.signal);
    if (canonical !== path || !inside(this.root, canonical))
      throw new Error("Project path denied.");
  }

  private async rules(directory: string): Promise<AdvisorIgnoreRule[]> {
    const cached = this.ignores.get(directory);
    if (cached) return cached;
    checkAdvisorAbort(this.signal);
    const rules = await readAdvisorIgnoreRules(directory, this.signal);
    checkAdvisorAbort(this.signal);
    this.ignores.set(directory, rules);
    return rules;
  }

  private async allowed(path: string): Promise<void> {
    await this.boundary(path);
    let directory = dirname(path);
    while (true) {
      for (const rule of await this.rules(directory)) {
        if (advisorIgnored(path, rule)) throw new Error("Ignored project path.");
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    checkAdvisorAbort(this.signal);
  }

  private path(input: unknown): string {
    if (
      typeof input !== "string" ||
      input.length > 2048 ||
      input.includes("\0") ||
      input.includes("\\") ||
      isAbsolute(input)
    ) {
      throw new Error("Use a relative project path.");
    }
    const path = resolve(this.root, input);
    if (!inside(this.root, path)) throw new Error("Project path denied.");
    return path;
  }

  private async read(path: string): Promise<{ path: string; text: string; truncated: boolean }> {
    await this.allowed(path);
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      checkAdvisorAbort(this.signal);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1) throw new Error("Not an allowed text file.");
      const buffer = Buffer.alloc(MAX_BYTES);
      checkAdvisorAbort(this.signal);
      const { bytesRead } = await handle.read(buffer, 0, MAX_BYTES, 0);
      checkAdvisorAbort(this.signal);
      await this.boundary(path);
      const after = await lstat(path);
      if (after.dev !== stat.dev || after.ino !== stat.ino)
        throw new Error("Project file changed.");
      const text = buffer.subarray(0, bytesRead).toString("utf8");
      if (text.includes("\0")) throw new Error("Not an allowed text file.");
      const source = relative(this.root, path).split(sep).join("/");
      this.readSources.add(source);
      return { path: source, text, truncated: stat.size > bytesRead };
    } finally {
      await handle.close();
    }
  }

  private async canAccess(path: string): Promise<boolean> {
    try {
      await this.allowed(path);
      return true;
    } catch {
      checkAdvisorAbort(this.signal);
      return false;
    }
  }

  private collectEntry(
    child: string,
    entry: { isDirectory(): boolean; isFile(): boolean },
    queue: string[],
    paths: string[],
  ): void {
    if (entry.isDirectory()) queue.push(child);
    else if (entry.isFile()) paths.push(child);
  }

  private async files(path: string): Promise<{ paths: string[]; truncated: boolean }> {
    await this.allowed(path);
    const paths: string[] = [];
    const queue = [path];
    let visited = 0;
    while (queue.length && visited < MAX_ENTRIES) {
      const directory = queue.shift();
      if (!directory) break;
      await this.allowed(directory);
      const entries = await opendir(directory);
      await this.boundary(directory);
      for await (const entry of entries) {
        checkAdvisorAbort(this.signal);
        if (++visited > MAX_ENTRIES) break;
        const child = join(directory, entry.name);
        if (!(await this.canAccess(child))) continue;
        this.collectEntry(child, entry, queue, paths);
      }
    }
    return { paths, truncated: queue.length > 0 || visited >= MAX_ENTRIES };
  }

  /** Execute a single local call. Errors are intentionally generic and contain no OS/provider data. */
  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    checkAdvisorAbort(this.signal);
    if (!["advisor_read", "advisor_list", "advisor_search"].includes(name))
      throw new Error("Unknown advisor tool.");
    const path = this.path(args.path ?? ".");
    if (name === "advisor_read") return JSON.stringify(await this.read(path));
    const { paths, truncated } = await this.files(path);
    if (name === "advisor_list") return this.listResult(paths, truncated);
    return this.search(paths, truncated, args.query);
  }

  private listResult(paths: string[], truncated: boolean): string {
    const files: string[] = [];
    let length = 0;
    for (const path of paths) {
      const source = relative(this.root, path).split(sep).join("/");
      length += source.length;
      if (length > 16000 || files.length >= 200) break;
      files.push(source);
    }
    return JSON.stringify({ files, truncated: truncated || files.length < paths.length });
  }

  private matchLines(
    path: string,
    body: string,
    query: string,
  ): Array<{ path: string; line: number; text: string }> {
    return body
      .split("\n")
      .map((text, index) => ({ path, line: index + 1, text }))
      .filter((match) => match.text.includes(query))
      .slice(0, 50)
      .map((match) => ({ ...match, text: match.text.slice(0, 300) }));
  }

  private async search(paths: string[], truncated: boolean, query: unknown): Promise<string> {
    if (typeof query !== "string" || !query.length || query.length > 200)
      throw new Error("Invalid search query.");
    const matches: Array<{ path: string; line: number; text: string }> = [];
    const sources: string[] = [];
    let bytes = 0;
    let sourceBytes = 0;
    let clipped = truncated;
    for (const file of paths.slice(0, 100)) {
      checkAdvisorAbort(this.signal);
      try {
        const result = await this.read(file);
        sources.push(result.path);
        sourceBytes += result.path.length;
        clipped ||= result.truncated;
        const found = this.matchLines(result.path, result.text, query);
        matches.push(...found.slice(0, 50 - matches.length));
        bytes += found.reduce((total, match) => total + match.text.length, 0);
      } catch {
        checkAdvisorAbort(this.signal);
      }
      if (matches.length >= 50 || bytes >= 12000 || sourceBytes >= 8000) {
        clipped = true;
        break;
      }
    }
    checkAdvisorAbort(this.signal);
    return JSON.stringify({
      matches,
      readSources: sources,
      truncated: clipped || paths.length > 100,
    });
  }
}
