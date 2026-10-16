import { assertStructuralProtocolMessageSize } from "./structural-worker-message-size.ts";
import { STRUCTURAL_WORKER_LIMITS } from "./structural-worker-protocol.ts";

/** Restore bounded binary chunks before the private Worker protocol validates them. */
export function decodeStructuralWorkerJsonMessage(message: unknown): unknown {
  assertStructuralProtocolMessageSize(message);
  if (!message || typeof message !== "object" || !("kind" in message) || message.kind !== "chunk") {
    return message;
  }
  const payload = "payload" in message ? message.payload : undefined;
  const maxLength = Math.ceil(STRUCTURAL_WORKER_LIMITS.targetChunkBytes / 3) * 4;
  if (typeof payload !== "string" || payload.length > maxLength) {
    throw new Error("Invalid Structural Worker JSON chunk payload");
  }
  const bytes = Buffer.from(payload, "base64");
  if (
    bytes.byteLength > STRUCTURAL_WORKER_LIMITS.targetChunkBytes ||
    bytes.toString("base64") !== payload
  ) {
    throw new Error("Invalid Structural Worker JSON chunk payload");
  }
  return { ...message, payload: bytes };
}
