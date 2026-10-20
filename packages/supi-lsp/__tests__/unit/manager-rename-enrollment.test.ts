import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LspManager } from "../../src/manager/manager.ts";
import { clientKey } from "../../src/manager/manager-helpers.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("LspManager rename document enrollment", () => {
  it("rejects a symlink escape before it opens any discovered document", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-rename-root-"));
    const outside = mkdtempSync(join(tmpdir(), "lsp-rename-outside-"));
    temporaryDirectories.push(root, outside);
    writeFileSync(join(root, "pyproject.toml"), "[project]\n", "utf-8");
    const outsideFile = join(outside, "escape.py");
    writeFileSync(outsideFile, "def model(): pass\n", "utf-8");
    const symlinkPath = join(root, "escape.py");
    symlinkSync(outsideFile, symlinkPath);
    const manager = new LspManager(
      {
        servers: {
          python: {
            command: "python",
            fileTypes: ["py"],
            rootMarkers: ["pyproject.toml"],
          },
        },
      },
      root,
    );
    const client = { name: "python", root };
    (manager as unknown as { clients: Map<string, unknown> }).clients.set(
      clientKey("python", root),
      client,
    );
    const ensureFileOpen = vi.spyOn(manager, "ensureFileOpen");

    const result = await manager.enrollRenameDocuments(client as never, [symlinkPath]);

    expect(result).toMatchObject({
      kind: "unavailable",
      reason: expect.stringContaining("not a regular file"),
    });
    expect(ensureFileOpen).not.toHaveBeenCalled();
  });

  it("stops before enrollment when the request deadline has expired", async () => {
    const manager = new LspManager({ servers: {} }, "/project");

    await expect(
      manager.enrollRenameDocuments(
        { name: "python", root: "/project" } as never,
        ["/project/model.py"],
        { deadline: Date.now() - 1 },
      ),
    ).rejects.toThrow("Code request deadline exceeded");
  });

  it("rejects an ordinary file outside the authorized route root", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-rename-root-"));
    const outside = mkdtempSync(join(tmpdir(), "lsp-rename-outside-"));
    temporaryDirectories.push(root, outside);
    writeFileSync(join(root, "pyproject.toml"), "[project]\n", "utf-8");
    const outsideFile = join(outside, "outside.py");
    writeFileSync(outsideFile, "def model(): pass\n", "utf-8");
    const manager = new LspManager(
      {
        servers: {
          python: {
            command: "python",
            fileTypes: ["py"],
            rootMarkers: ["pyproject.toml"],
          },
        },
      },
      root,
    );
    const client = { name: "python", root };
    (manager as unknown as { clients: Map<string, unknown> }).clients.set(
      clientKey("python", root),
      client,
    );
    const ensureFileOpen = vi.spyOn(manager, "ensureFileOpen");

    const result = await manager.enrollRenameDocuments(client as never, [outsideFile]);

    expect(result).toMatchObject({
      kind: "unavailable",
      reason: expect.stringContaining("outside the semantic route root"),
    });
    expect(ensureFileOpen).not.toHaveBeenCalled();
  });

  it("rejects a rename target set above the file bound before opening documents", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-rename-limit-"));
    temporaryDirectories.push(root);
    writeFileSync(join(root, "pyproject.toml"), "[project]\n", "utf-8");
    const directory = join(root, "files");
    mkdirSync(directory);
    const files = Array.from({ length: 65 }, (_, index) => {
      const file = join(directory, `file-${index}.py`);
      writeFileSync(file, "def model(): pass\n", "utf-8");
      return file;
    });
    const manager = new LspManager(
      {
        servers: {
          python: {
            command: "python",
            fileTypes: ["py"],
            rootMarkers: ["pyproject.toml"],
          },
        },
      },
      root,
    );
    const ensureFileOpen = vi.spyOn(manager, "ensureFileOpen");

    const result = await manager.enrollRenameDocuments({ name: "python", root } as never, files);

    expect(result).toMatchObject({ kind: "unavailable" });
    expect(ensureFileOpen).not.toHaveBeenCalled();
  });
});
