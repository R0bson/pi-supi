import type { StructuralProvider } from "@mrclrchtr/supi-code-runtime/api";
import { describe, expect, it } from "vitest";
import { gatherSubstrateContext } from "../../../src/session/orientation/gather.ts";

describe("gatherSubstrateContext", () => {
  it("preserves recovered node and outline evidence with operation ranges", async () => {
    const structural = {
      nodeAt: async () => ({
        kind: "partial" as const,
        file: "sample.ts",
        reason: "Recovered node context.",
        errorRanges: [{ start: { line: 2, character: 0 }, end: { line: 2, character: 0 } }],
        data: {
          type: "identifier",
          text: "target",
          startLine: 1,
          startCharacter: 1,
          endLine: 1,
          endCharacter: 7,
          ancestry: [],
        },
      }),
      outline: async () => ({
        kind: "partial" as const,
        file: "sample.ts",
        reason: "Recovered outline context.",
        errorRanges: [{ start: { line: 4, character: 1 }, end: { line: 4, character: 1 } }],
        data: [
          {
            name: "target",
            kind: "function",
            startLine: 1,
            startCharacter: 1,
            endLine: 3,
            endCharacter: 1,
          },
        ],
      }),
      imports: async () => ({ kind: "success" as const, data: [] }),
      exports: async () => ({ kind: "success" as const, data: [] }),
    } satisfies Pick<StructuralProvider, "nodeAt" | "outline" | "imports" | "exports">;

    const result = await gatherSubstrateContext(structural, "sample.ts", 1, 1, true);

    expect(result.nodeInfo?.type).toBe("identifier");
    expect(result.outline).toEqual([
      { name: "target", kind: "function", startLine: 1, endLine: 3 },
    ]);
    expect(result.recovery).toEqual([
      expect.objectContaining({ operation: "nodeAt", reason: "Recovered node context." }),
      expect.objectContaining({ operation: "outline", reason: "Recovered outline context." }),
    ]);
  });
});
