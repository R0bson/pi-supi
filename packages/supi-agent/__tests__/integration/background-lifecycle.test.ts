import { afterEach, describe, expect, it, vi } from "vitest";
import { backgroundHarness, task } from "../helpers/background-harness.ts";

const sdk = vi.hoisted(() => ({ createAgentSession: vi.fn(), createAgentSessionRuntime: vi.fn() }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  ...sdk,
}));
let harness: Awaited<ReturnType<typeof backgroundHarness>> | undefined;
afterEach(async () => {
  await harness?.close();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("background parent lifecycle", () => {
  it("cancels one batch repeatedly without stopping another batch", async () => {
    harness = await backgroundHarness(sdk);
    const canceled = await harness.invoke("agent_run", { tasks: [task("cancel")] });
    const kept = await harness.invoke("agent_run", { tasks: [task("keep")] });
    await vi.waitFor(() =>
      expect(harness?.children.filter((child) => child.session.isStreaming)).toHaveLength(2),
    );
    await harness.invoke("agent_cancel", { batchId: canceled.details.batchId });
    await harness.invoke("agent_cancel", { batchId: canceled.details.batchId });
    const result = await harness.invoke("agent_result", {
      batchId: canceled.details.batchId,
      wait: true,
    });
    expect(result.details).toMatchObject({
      tasks: [expect.objectContaining({ status: "canceled" })],
    });
    expect(harness.child("keep").session.isStreaming).toBe(true);
    harness.child("keep").finish("Kept result");
    const completed = await harness.invoke("agent_result", {
      batchId: kept.details.batchId,
      wait: true,
    });
    expect(completed.details).toMatchObject({
      tasks: [expect.objectContaining({ status: "completed" })],
    });
  });
  it("keeps launch ownership through compaction but cancels an abandoned branch", async () => {
    harness = await backgroundHarness(sdk);
    const start = await harness.invoke("agent_run", { tasks: [task()] });
    await vi.waitFor(() => expect(harness?.children[0]?.session.isStreaming).toBe(true));
    harness.manager.appendCompaction("Summary", null, 100);
    const originalLeaf = harness.manager.getLeafId();
    await harness.pi.emit("session_tree", { type: "session_tree" }, harness.ctx);
    expect(harness.children[0].session.isStreaming).toBe(true);
    harness.manager.resetLeaf();
    await harness.pi.emit("session_tree", { type: "session_tree" }, harness.ctx);
    await vi.waitFor(() => expect(harness?.children[0]?.runtime.dispose).toHaveBeenCalled());
    await expect(
      harness.invoke("agent_result", { batchId: start.details.batchId }),
    ).rejects.toThrow(/branch/i);
    expect(harness.pi.messages).toHaveLength(0);
    harness.manager.branch(originalLeaf as string);
    const canceled = await harness.invoke("agent_result", {
      batchId: start.details.batchId,
      wait: true,
    });
    expect(canceled.details).toMatchObject({
      tasks: [expect.objectContaining({ status: "canceled" })],
    });
  });
  it("parent abort releases a result wait, stops children, and does not restart the parent", async () => {
    harness = await backgroundHarness(sdk);
    const parent = await harness.beginParent();
    const start = await harness.invoke("agent_run", { tasks: [task()] });
    await vi.waitFor(() => expect(harness?.children[0]?.session.isStreaming).toBe(true));
    const waiting = harness.invoke("agent_result", { batchId: start.details.batchId, wait: true });
    const assertion = expect(waiting).rejects.toThrow(/abort|cancel/i);
    parent.abort();
    await assertion;
    await vi.waitFor(() => expect(harness?.children[0]?.runtime.dispose).toHaveBeenCalled());
    await harness.endParent(true);
    expect(harness.pi.messages).toHaveLength(0);
    const canceled = await harness.invoke("agent_result", {
      batchId: start.details.batchId,
      wait: true,
    });
    expect(canceled.details).toMatchObject({
      complete: true,
      tasks: [expect.objectContaining({ status: "canceled" })],
    });
  });
});
