import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

export function writePiShim(directory: string, script: string): string {
  mkdirSync(directory, { recursive: true });
  if (process.platform === "win32") {
    const path = join(directory, "pi.cmd");
    writeFileSync(path, `@"${process.execPath}" "${script}" %*\r\n`);
    return path;
  }
  const path = join(directory, "pi");
  writeFileSync(
    path,
    `#!/usr/bin/env node\nimport ${JSON.stringify(pathToFileURL(script).href)};\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

export async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (existsSync(path)) return;
    await delay(10);
  }
  throw new Error(`Fixture did not create ${path}`);
}

export function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "supi-installer-")));
  const project = join(root, "project space ü");
  const agentDir = join(root, "agent");
  mkdirSync(project);
  writeJson(join(agentDir, "trust.json"), { [root]: true });
  return { root, project, agentDir };
}
