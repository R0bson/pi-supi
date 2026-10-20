import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCFamilyFileAssociationResolver,
  WorkspaceRuntime,
} from "@mrclrchtr/supi-code-runtime/api";
import { afterEach, describe, expect, it } from "vitest";
import { LspRuntimeController } from "../../src/api.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/lsp-semantic-server.mjs", import.meta.url));
const workspaces: string[] = [];

function readLog(filePath: string): Array<{ method: string; params?: unknown }> {
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { method: string; params?: unknown });
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

describe("C-family LSP document language IDs", () => {
  it("uses the workspace association snapshot and keeps the C route", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lsp-file-associations-"));
    workspaces.push(cwd);
    fs.mkdirSync(path.join(cwd, ".pi", "supi"), { recursive: true });
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.mkdirSync(path.join(cwd, "vendor"), { recursive: true });
    fs.mkdirSync(path.join(cwd, "include"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "CMakeLists.txt"), "project(file-associations)");
    const logPath = path.join(cwd, "lsp.jsonl");
    fs.writeFileSync(logPath, "");
    fs.writeFileSync(
      path.join(cwd, ".pi", "supi", "config.json"),
      JSON.stringify({
        lsp: {
          servers: {
            c: { command: process.execPath, args: [FIXTURE, logPath, "0"] },
          },
        },
      }),
    );
    const files = [
      { path: path.join(cwd, "src", "template.h"), languageId: "cpp" },
      { path: path.join(cwd, "vendor", "vendor.h"), languageId: "c" },
      { path: path.join(cwd, "include", "default.h"), languageId: "c" },
    ];
    for (const file of files) fs.writeFileSync(file.path, "struct Header { int value; };");

    const associations = createCFamilyFileAssociationResolver(cwd, [
      { pattern: "vendor/**/*.h", language: "c" },
      { pattern: "src/**/*.h", language: "cpp" },
    ]);
    const controller = new LspRuntimeController(cwd, new WorkspaceRuntime(), {
      projectTrusted: true,
      fileAssociations: associations,
      homeDir: path.join(cwd, "empty-home"),
    });
    try {
      const start = await controller.start();
      if (start.kind !== "ready") throw new Error(`LSP did not start: ${start.kind}`);
      for (const file of files) {
        await expect(start.runtime.documentSymbols(file.path)).resolves.toMatchObject({
          kind: "completed",
          data: [],
        });
      }

      const openDocuments = readLog(logPath)
        .filter((entry) => entry.method === "textDocument/didOpen")
        .map((entry) => {
          const params = entry.params as {
            textDocument: { uri: string; languageId: string };
          };
          return [
            decodeURIComponent(new URL(params.textDocument.uri).pathname),
            params.textDocument.languageId,
          ];
        });
      expect(openDocuments).toEqual(files.map((file) => [file.path, file.languageId]));
      expect(controller.projectServers).toContainEqual(
        expect.objectContaining({ name: "c", status: "running" }),
      );
    } finally {
      await controller.shutdown();
    }
  });
});
