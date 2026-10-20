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

describe("saved native child context", () => {
  it("keeps parent ancestry, child compaction, and child context edits", async () => {
    harness = await backgroundHarness(sdk);
    const firstRun = harness.invoke("agent_run", {
      mode: "foreground",
      tasks: [{ id: "A", new: { profile: "explore" }, instructions: "Inspect A module." }],
    });
    await vi.waitFor(() => expect(harness?.children[0]?.session.isStreaming).toBe(true));
    const childManager = harness.children[0]?.session.sessionManager;
    const firstUser = childManager
      ?.getBranch()
      .find((entry) => entry.type === "message" && entry.message.role === "user");
    if (!childManager || firstUser?.type !== "message") throw new Error("Missing child prompt.");
    childManager.appendCompaction("Child summary keeps the A finding.", firstUser.id, 20);
    childManager.appendContextEdit(firstUser.id, {
      content: "Edited A instruction retained in native history.",
    });
    harness.children[0]?.finish("A finding retained in child history.");
    const first = await firstRun;
    const conversationId = (first.details as { tasks: Array<{ conversationId: string }> }).tasks[0]
      ?.conversationId;

    const checkpoint = (first.details as { tasks: Array<{ checkpoint: { entries: unknown[] } }> })
      .tasks[0]?.checkpoint;
    expect(checkpoint?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "compaction" }),
        expect.objectContaining({ type: "context_edit" }),
      ]),
    );

    harness.manager.appendCompaction("Parent summary only.", null, 100);
    const parentBranch = harness.manager.getBranch();
    expect(parentBranch.some((entry) => entry.type === "compaction")).toBe(true);
    expect(JSON.stringify(parentBranch)).toContain("A finding retained in child history.");
    expect(JSON.stringify(harness.manager.buildSessionContext())).not.toContain(
      "A finding retained in child history.",
    );
    expect(await harness.invoke("agent_list", {})).toMatchObject({
      details: { rows: [expect.objectContaining({ conversationId, status: "available" })] },
    });

    const followUp = harness.invoke("agent_run", {
      mode: "foreground",
      tasks: [
        {
          id: "B",
          continue: { conversationId },
          instructions: "Inspect B module.",
        },
      ],
    });
    await vi.waitFor(() => expect(harness?.children[1]?.session.isStreaming).toBe(true));
    const restored = harness.children[1]?.session.sessionManager;
    const restoredEntries = restored?.getEntries() ?? [];
    expect(restoredEntries.some((entry) => entry.type === "compaction")).toBe(true);
    expect(restoredEntries.some((entry) => entry.type === "context_edit")).toBe(true);
    expect(JSON.stringify(restoredEntries)).toContain("A finding retained in child history.");
    expect(JSON.stringify(restored?.buildSessionContext())).toContain(
      "Edited A instruction retained in native history.",
    );
    expect(JSON.stringify(restored?.buildSessionContext())).toContain(
      "Child summary keeps the A finding.",
    );
    harness.children[1]?.finish("B finding.");
    await followUp;
  });
});
