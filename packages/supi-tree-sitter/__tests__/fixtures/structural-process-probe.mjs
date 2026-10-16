import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { createTreeSitterSession } = await jiti.import("../../src/session/session.ts");

if (process.argv.includes("--compiled-parent")) {
  // Node-only CI uses an executable that cannot run the process host.
  Object.defineProperty(process.versions, "bun", { value: "test", configurable: true });
  Object.defineProperty(process, "execPath", { value: "/missing/compiled-application" });
}

const directory = mkdtempSync(join(tmpdir(), "supi-structural-process-"));
const largeResult = process.argv.includes("--large-result");
const file = largeResult
  ? join(directory, "large.ts")
  : fileURLToPath(new URL("./sample.ts", import.meta.url));
if (largeResult) {
  writeFileSync(
    file,
    Array.from({ length: 4_000 }, (_, index) => `export function item${index}() {}`).join("\n"),
  );
}
const session = createTreeSitterSession(process.cwd());
try {
  const result = await session.outline(file);
  const summary =
    result.kind === "success"
      ? { kind: result.kind, names: result.data.map((item) => item.name) }
      : result;
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exitCode = result.kind === "success" ? 0 : 1;
} finally {
  await session.dispose();
  rmSync(directory, { recursive: true, force: true });
}
