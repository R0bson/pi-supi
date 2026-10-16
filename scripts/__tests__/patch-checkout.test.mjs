import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";

const patchPaths = [
  "packages/supi-skill-patches/patches/mattpocock-skills/combined.patch",
  "packages/supi-skill-patches/patches/mattpocock-skills/files/skills/engineering/code-review/SKILL.md.patch",
];

it("keeps pnpm patches at LF when Git uses CRLF for other text files", () => {
  const root = mkdtempSync(join(tmpdir(), "supi-patch-checkout-"));
  const git = (args) =>
    execFileSync("git", ["-c", "core.autocrlf=true", ...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: join(root, "empty-git-config"),
      },
      stdio: "pipe",
    });
  try {
    for (const path of [".gitattributes", ...patchPaths]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), readFileSync(new URL(`../../${path}`, import.meta.url)));
    }
    writeFileSync(join(root, "control.txt"), "Plain text\n");
    git(["init", "--quiet"]);
    git(["add", ".gitattributes", "control.txt", ...patchPaths]);
    for (const path of ["control.txt", ...patchPaths]) rmSync(join(root, path));

    // Use Git checkout conversion to test Windows line endings on every host.
    git(["checkout-index", "--all", "--force"]);
    expect(readFileSync(join(root, "control.txt"), "utf8")).toBe("Plain text\r\n");
    for (const path of patchPaths) {
      expect(readFileSync(join(root, path)).includes(13), `${path} must retain LF`).toBe(false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);
