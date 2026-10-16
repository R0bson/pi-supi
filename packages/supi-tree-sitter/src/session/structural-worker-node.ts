import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";

/** Select a real Node executable without re-entering a compiled Bun application. */
export function resolveStructuralWorkerNode(): string {
  if (!process.versions.bun) return process.execPath;

  const probe = spawnSync(
    "node",
    [
      "--liftoff-only",
      "--eval",
      "if (!process.versions.bun) process.stdout.write(process.execPath)",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "" },
      timeout: 2_000,
      maxBuffer: 4_096,
      windowsHide: true,
    },
  );
  if (probe.status !== 0 || !probe.stdout || !isAbsolute(probe.stdout)) {
    throw new Error(
      "Structural analysis under Bun requires Node.js on PATH. Install Node.js and restart Pi.",
    );
  }
  return probe.stdout;
}
