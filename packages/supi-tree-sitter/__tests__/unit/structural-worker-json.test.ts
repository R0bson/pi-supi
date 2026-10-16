import { describe, expect, it } from "vitest";
import { decodeStructuralWorkerJsonMessage } from "../../src/session/structural-worker-json.ts";
import {
  STRUCTURAL_WORKER_LIMITS,
  validateWorkerToParentMessage,
} from "../../src/session/structural-worker-protocol.ts";

function chunk(payload: unknown, encodedBytes = 2) {
  return {
    kind: "chunk",
    version: 1,
    generation: 1,
    requestId: "test-1",
    sequence: 0,
    final: true,
    encodedBytes,
    payload,
  };
}

describe("Structural Worker JSON transport", () => {
  it("restores binary chunks before protocol validation", () => {
    const message = decodeStructuralWorkerJsonMessage(chunk("AP8=", 2));
    expect(validateWorkerToParentMessage(message)).toMatchObject({ kind: "valid" });
    expect(message).toMatchObject({ payload: Buffer.from([0, 255]) });
  });

  it("keeps non-chunk messages unchanged", () => {
    const ready = { kind: "ready", version: 1, generation: 1 };
    expect(decodeStructuralWorkerJsonMessage(ready)).toBe(ready);
  });

  it.each(["!!!!", "e30", "e31=", "e30=\n", "e30===", new Uint8Array([1, 2]), null])(
    "rejects non-canonical base64 payload %j",
    (payload) => {
      expect(() => decodeStructuralWorkerJsonMessage(chunk(payload))).toThrow(
        "Invalid Structural Worker JSON chunk payload",
      );
    },
  );

  it("accepts the maximum binary chunk without changing the bytes", () => {
    const bytes = Buffer.alloc(STRUCTURAL_WORKER_LIMITS.targetChunkBytes, 255);
    const message = decodeStructuralWorkerJsonMessage(
      chunk(bytes.toString("base64"), bytes.length),
    );
    expect(validateWorkerToParentMessage(message)).toMatchObject({ kind: "valid" });
    const decoded = message as { payload: Uint8Array };
    expect(Buffer.compare(Buffer.from(decoded.payload), bytes)).toBe(0);
  });

  it("rejects an oversize decoded chunk even when its encoded length fits", () => {
    const bytes = Buffer.alloc(STRUCTURAL_WORKER_LIMITS.targetChunkBytes + 1);
    expect(() =>
      decodeStructuralWorkerJsonMessage(chunk(bytes.toString("base64"), bytes.length)),
    ).toThrow("Invalid Structural Worker JSON chunk payload");
  });

  it("rejects an oversize envelope before decoding", () => {
    expect(() =>
      decodeStructuralWorkerJsonMessage({
        kind: "ready",
        detail: "x".repeat(STRUCTURAL_WORKER_LIMITS.maxMessageBytes),
      }),
    ).toThrow("Structural Worker message exceeds the byte limit");
  });

  it("keeps protocol byte-count validation after decoding", () => {
    const message = decodeStructuralWorkerJsonMessage(chunk("e30=", 3));
    expect(validateWorkerToParentMessage(message)).toEqual({
      kind: "invalid",
      reason: "Invalid chunk byte count",
    });
  });
});
