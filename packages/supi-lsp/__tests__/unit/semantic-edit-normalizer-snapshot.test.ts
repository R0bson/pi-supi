import { describe, expect, it } from "vitest";
import { normalizeSemanticEdit } from "../../src/provider/semantic-edit-normalizer.ts";

const uri = "file:///src/model.py";
const edit = {
  documentChanges: [
    {
      textDocument: { uri, version: null },
      edits: [
        {
          range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
          newText: "renamed",
        },
      ],
    },
  ],
};

function context(options: {
  openVersion: number | null;
  snapshot?: {
    version: number;
    contentFingerprint: string;
    diskContentFingerprint: string;
  };
}) {
  return {
    getOpenDocumentVersion: () => options.openVersion,
    getSynchronizedDocumentSnapshot: () => options.snapshot ?? null,
    authorizedMutationRoots: ["/src"],
  };
}

describe("semantic edit content snapshot preconditions", () => {
  it("rejects a null-version edit to an open document without transaction evidence", () => {
    const result = normalizeSemanticEdit(
      { kind: "workspace-edit", edit },
      context({ openVersion: 4 }),
    );

    expect(result).toMatchObject({ kind: "unavailable" });
  });

  it.each([null, 4])("retains synchronized content for an edit with version %s", (version) => {
    const result = normalizeSemanticEdit(
      {
        kind: "workspace-edit",
        edit: {
          documentChanges: [{ ...edit.documentChanges[0], textDocument: { uri, version } }],
        },
      },
      context({
        openVersion: 4,
        snapshot: {
          version: 4,
          contentFingerprint: "same-content",
          diskContentFingerprint: "same-content",
        },
      }),
    );

    expect(result).toMatchObject({
      kind: "precise",
      edits: {
        documentPreconditions: [
          {
            file: "/src/model.py",
            kind: "open-document-content",
            version: 4,
            fingerprint: "same-content",
          },
        ],
      },
    });
  });

  it("does not use a matching snapshot to bypass a numeric version mismatch", () => {
    const result = normalizeSemanticEdit(
      {
        kind: "workspace-edit",
        edit: {
          documentChanges: [{ ...edit.documentChanges[0], textDocument: { uri, version: 3 } }],
        },
      },
      context({
        openVersion: 4,
        snapshot: {
          version: 4,
          contentFingerprint: "same-content",
          diskContentFingerprint: "same-content",
        },
      }),
    );
    expect(result).toMatchObject({ kind: "unavailable" });
  });

  it("rejects a snapshot after its document has closed", () => {
    const result = normalizeSemanticEdit(
      { kind: "workspace-edit", edit },
      context({
        openVersion: null,
        snapshot: {
          version: 4,
          contentFingerprint: "same-content",
          diskContentFingerprint: "same-content",
        },
      }),
    );

    expect(result).toMatchObject({ kind: "unavailable" });
  });

  it.each([
    {
      label: "snapshot from another client version",
      openVersion: 5,
      snapshot: {
        version: 4,
        contentFingerprint: "same-content",
        diskContentFingerprint: "same-content",
      },
    },
    {
      label: "buffer does not match disk",
      openVersion: 4,
      snapshot: {
        version: 4,
        contentFingerprint: "buffer-content",
        diskContentFingerprint: "disk-content",
      },
    },
  ])("rejects a null-version edit with $label", ({ openVersion, snapshot }) => {
    const result = normalizeSemanticEdit(
      { kind: "workspace-edit", edit },
      context({ openVersion, snapshot }),
    );

    expect(result).toMatchObject({ kind: "unavailable" });
  });
});
