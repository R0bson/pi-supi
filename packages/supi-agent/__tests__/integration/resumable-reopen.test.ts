import { afterEach, describe, expect, it, vi } from "vitest";
import { backgroundHarness } from "../helpers/background-harness.ts";

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

describe("parent reopen with uncollected work", () => {
  it("restores only the last saved checkpoint and expires the old batch handle", async () => {
    harness = await backgroundHarness(sdk, { persistentParent: true });
    const firstRun = harness.invoke("agent_run", {
      mode: "foreground",
      tasks: [{ id: "A", new: { profile: "explore" }, instructions: "Inspect A module." }],
    });
    await waitForChild(0);
    harness.children[0]?.finish("A findings.");
    const first = await firstRun;
    const conversationId = (first.details as { tasks: Array<{ conversationId: string }> }).tasks[0]
      ?.conversationId;
    const checkpointA = (
      first.details as { tasks: Array<{ checkpoint: { checkpointId: string } }> }
    ).tasks[0]?.checkpoint;

    const started = await harness.invoke("agent_run", {
      tasks: [{ id: "B", continue: { conversationId }, instructions: "Inspect B module." }],
    });
    const batchId = (started.details as { batchId: string }).batchId;
    await waitForChild(1);
    harness.children[1]?.finish("B findings not yet collected.");
    await vi.waitFor(() =>
      expect(
        harness?.registry.snapshot().runs.find((run) => run.taskDescription === "Inspect B module.")
          ?.status,
      ).toBe("completed"),
    );

    await harness.reopenParent();
    const listed = await harness.invoke("agent_list", {});
    expect(listed.details).toMatchObject({
      total: 1,
      rows: [expect.objectContaining({ conversationId, status: "available" })],
    });
    expect(JSON.stringify(listed.details)).not.toContain("B findings not yet collected.");
    await expect(harness.invoke("agent_result", { batchId })).rejects.toThrow(
      "Unknown or expired background batch handle",
    );

    const followUp = harness.invoke("agent_run", {
      mode: "foreground",
      tasks: [{ id: "C", continue: { conversationId }, instructions: "Inspect C module." }],
    });
    await waitForChild(2);
    const childEntries = harness.children[2]?.session.sessionManager.getEntries();
    expect(JSON.stringify(childEntries)).toContain("A findings.");
    expect(JSON.stringify(childEntries)).not.toContain("B findings not yet collected.");
    harness.children[2]?.finish("C findings.");
    const third = await followUp;
    const checkpointC = (
      third.details as {
        tasks: Array<{ checkpoint: { parentCheckpointId: string | null } }>;
      }
    ).tasks[0]?.checkpoint;
    expect(checkpointC?.parentCheckpointId).toBe(checkpointA?.checkpointId);
  }, 10_000);
});

async function waitForChild(index: number): Promise<void> {
  await vi.waitFor(() => expect(harness?.children[index]?.session.isStreaming).toBe(true));
}
