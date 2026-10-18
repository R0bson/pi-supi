import { afterEach, describe, expect, it, vi } from "vitest";
import { backgroundHarness, task } from "../helpers/background-harness.ts";

const sdk = vi.hoisted(() => ({ createAgentSession: vi.fn(), createAgentSessionRuntime: vi.fn() }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  ...sdk,
}));
let harness: Awaited<ReturnType<typeof backgroundHarness>> | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await harness?.close();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("terminal background outcomes", () => {
  it("retains Usage after a runtime prompt failure", async () => {
    harness = await backgroundHarness(sdk);
    const start = await harness.invoke("agent_run", { tasks: [task()] });
    await vi.waitFor(() => expect(harness?.children[0]?.session.isStreaming).toBe(true));
    harness.child("one").fail();
    await vi.waitFor(() => expect(harness?.pi.messages).toHaveLength(1));
    const result = await harness.invoke("agent_result", { batchId: start.details.batchId });
    expect(result.details).toMatchObject({
      tasks: [expect.objectContaining({ status: "failed" })],
    });
    expect(result.usage?.totalTokens).toBe(15);
    expect(JSON.stringify(result.content)).not.toContain("Controlled SDK failure");
  });

  it("retains billed Usage when a profile timeout stops its child", async () => {
    harness = await backgroundHarness(sdk, { timeoutMinutes: 1 });
    vi.useFakeTimers();
    const start = await harness.invoke("agent_run", { tasks: [task()] });
    await vi.waitFor(() => expect(harness?.children[0]?.session.isStreaming).toBe(true));
    harness.child("one").bill();
    await vi.advanceTimersByTimeAsync(60_001);
    const result = await harness.invoke("agent_result", {
      batchId: start.details.batchId,
      wait: true,
    });
    expect(result.details).toMatchObject({
      tasks: [expect.objectContaining({ status: "timeout" })],
    });
    expect(result.usage?.totalTokens).toBe(15);
  });

  it("retains billed Usage after explicit cancellation", async () => {
    harness = await backgroundHarness(sdk);
    const start = await harness.invoke("agent_run", { tasks: [task()] });
    await vi.waitFor(() => expect(harness?.children[0]?.session.isStreaming).toBe(true));
    harness.child("one").bill();
    await harness.invoke("agent_cancel", { batchId: start.details.batchId });
    const result = await harness.invoke("agent_result", {
      batchId: start.details.batchId,
      wait: true,
    });
    expect(result.details).toMatchObject({
      tasks: [expect.objectContaining({ status: "canceled" })],
    });
    expect(result.usage?.totalTokens).toBe(15);
    expect(harness.pi.messages).toHaveLength(0);
  });
});
