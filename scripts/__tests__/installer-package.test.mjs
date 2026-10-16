import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { packStaged } from "../pack-staged.mjs";

it("packs a standalone executable with no PI extension surface or build output", {
  timeout: 120_000,
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "supi-installer-pack-"));
  try {
    const tarball = await packStaged("packages/supi-installer", { outDir: directory });
    execFileSync("tar", ["-xzf", tarball, "-C", directory]);
    const root = join(directory, "package");
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(manifest.bin).toEqual({ "supi-installer": "bin/supi-installer.mjs" });
    expect(manifest.pi).toBeUndefined();
    expect(manifest.exports).toBeUndefined();
    expect(manifest.devDependencies).toBeUndefined();
    expect(readFileSync(join(root, manifest.bin["supi-installer"]), "utf8")).toMatch(
      /^#!\/usr\/bin\/env node/,
    );
    expect(statSync(join(root, manifest.bin["supi-installer"])).mode & 0o111).not.toBe(0);
    expect(readFileSync(join(root, "src/cli.mjs"), "utf8")).toContain("runCli");
    expect(readFileSync(join(root, "README.md"), "utf8")).toContain("Installation Matrix");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
