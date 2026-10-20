import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyWorkspaceEdit } from "../../../../src/analysis/refactor/apply.ts";

const temporaryDirectories: string[] = [];

function fingerprint(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("applyWorkspaceEdit synchronized content precondition", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function makeFile(): { file: string; root: string; content: string } {
    const root = mkdtempSync(path.join(os.tmpdir(), "apply-content-precondition-"));
    temporaryDirectories.push(root);
    const file = path.join(root, "model.py");
    const content = "def model():\n    return 1\n";
    writeFileSync(file, content, "utf-8");
    return { file, root, content };
  }

  function workspaceEdit(file: string, fingerprintValue: string) {
    return {
      edits: [
        {
          file,
          range: { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } },
          newText: "renamed",
        },
      ],
      documentPreconditions: [
        {
          file,
          kind: "open-document-content" as const,
          version: 7,
          fingerprint: fingerprintValue,
        },
      ],
    };
  }

  it("applies when the synchronized content and client version still match", async () => {
    const { file, root, content } = makeFile();
    const result = await applyWorkspaceEdit(workspaceEdit(file, fingerprint(content)), {
      authorizedMutationRoots: [realpathSync(root)],
      expectedFingerprints: new Map([[file, fingerprint(content)]]),
      getOpenDocumentVersion: () => 7,
    });

    if (result.kind === "error") throw new Error(result.reason);
    expect(result.kind).toBe("applied");
    expect(readFileSync(file, "utf-8")).toContain("def renamed():");
  });

  it("rejects a stale client version without changing the file", async () => {
    const { file, root, content } = makeFile();
    const result = await applyWorkspaceEdit(workspaceEdit(file, fingerprint(content)), {
      authorizedMutationRoots: [realpathSync(root)],
      expectedFingerprints: new Map([[file, fingerprint(content)]]),
      getOpenDocumentVersion: () => 8,
    });

    expect(result).toMatchObject({ kind: "error" });
    expect(readFileSync(file, "utf-8")).toBe(content);
  });

  it("rejects a snapshot fingerprint that differs from the stored file fingerprint", async () => {
    const { file, root, content } = makeFile();
    const result = await applyWorkspaceEdit(workspaceEdit(file, "not-the-plan-content"), {
      authorizedMutationRoots: [realpathSync(root)],
      expectedFingerprints: new Map([[file, fingerprint(content)]]),
      getOpenDocumentVersion: () => 7,
    });

    expect(result).toMatchObject({ kind: "error" });
    expect(readFileSync(file, "utf-8")).toBe(content);
  });
});
