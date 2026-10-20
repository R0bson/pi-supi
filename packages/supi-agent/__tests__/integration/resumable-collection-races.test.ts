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

describe("checkpoint collection through registered tools", () => {
  it("blocks a follow-up until the collected checkpoint is stored", async () => {
    harness = await backgroundHarness(sdk);
    const { batchId, conversationId } = await saveAThenStartB();

    const stripped = await harness.invoke(
      "agent_result",
      { batchId, wait: true },
      { resultHook: stripCheckpoints },
    );
    expect(stripped.usage?.totalTokens).toBe(15);
    expect(storedCollection()).toMatchObject({
      usage: { totalTokens: 15 },
      details: {
        batchId,
        tasks: [expect.objectContaining({ taskId: "B", conversationId })],
      },
    });
    const stored = storedCollection();
    if (!stored) throw new Error("Missing stored collection.");
    expect(
      (stored.details as { tasks: Array<{ checkpoint?: unknown }> }).tasks[0]?.checkpoint,
    ).toBeUndefined();
    await expectBlockedFollowUp(conversationId, "C-too-soon", "Collect it with agent_result");

    const retried = await harness.invoke("agent_result", { batchId });
    expect(retried.usage).toBeUndefined();
    expect(retried.details.alreadyCollected).toBe(false);
    const checkpointB = checkpointFrom(retried);
    expect(checkpointB).toBeDefined();
    await runFollowUp(conversationId, "C", "C findings.");
    const checkpointC = checkpointFrom(lastAgentRunResult());
    expect(checkpointC?.parentCheckpointId).toBe(checkpointB?.checkpointId);

    const lateCollection = await harness.invoke("agent_result", { batchId });
    expect(lateCollection.usage).toBeUndefined();
    expect(lateCollection.details.alreadyCollected).toBe(true);
    expect(
      (lateCollection.details as { tasks: Array<{ checkpoint?: unknown }> }).tasks[0]?.checkpoint,
    ).toBeUndefined();
    await runFollowUp(conversationId, "D", "D findings.");
    expect(checkpointFrom(lastAgentRunResult())?.parentCheckpointId).toBe(
      checkpointC?.checkpointId,
    );
  }, 10_000);

  it("releases concurrent unstored claims and retries checkpoint and Usage together", async () => {
    harness = await backgroundHarness(sdk);
    const { batchId, conversationId } = await saveAThenStartB();

    const [unstored, stripped] = await Promise.all([
      harness.invoke("agent_result", { batchId }, false),
      harness.invoke("agent_result", { batchId }, { resultHook: stripCheckpoints, endTurn: false }),
    ]);
    expect(unstored.usage?.totalTokens).toBe(15);
    expect(checkpointFrom(unstored)).toBeDefined();
    expect(stripped.usage).toBeUndefined();
    expect(stripped.details.alreadyCollected).toBe(false);
    expect(stripped.details).toMatchObject({
      batchId,
      tasks: [expect.objectContaining({ taskId: "B", conversationId })],
    });
    expect(
      (stripped.details as { tasks: Array<{ checkpoint?: unknown }> }).tasks[0]?.checkpoint,
    ).toBeUndefined();
    await expectBlockedFollowUp(conversationId, "C-too-soon", "Collect it with agent_result");

    await harness.endTurn();
    const retry = await harness.invoke("agent_result", { batchId });
    expect(retry.usage?.totalTokens).toBe(15);
    expect(checkpointFrom(retry)).toBeDefined();
    await runFollowUp(conversationId, "C", "C findings.");
    expect(checkpointFrom(lastAgentRunResult())?.parentCheckpointId).toBe(
      checkpointFrom(retry)?.checkpointId,
    );
  }, 10_000);
});

async function saveAThenStartB(): Promise<{ batchId: string; conversationId: string }> {
  if (!harness) throw new Error("Missing test harness.");
  const firstRun = harness.invoke("agent_run", {
    mode: "foreground",
    tasks: [{ id: "A", new: { profile: "explore" }, instructions: "Inspect A module." }],
  });
  await vi.waitFor(() => expect(harness?.children[0]?.session.isStreaming).toBe(true));
  harness.children[0]?.finish("A findings.");
  const first = await firstRun;
  const conversationId = (first.details as { tasks: Array<{ conversationId: string }> }).tasks[0]
    ?.conversationId;
  if (!conversationId) throw new Error("Missing conversation reference.");
  const started = await harness.invoke("agent_run", {
    tasks: [{ id: "B", continue: { conversationId }, instructions: "Inspect B module." }],
  });
  const batchId = (started.details as { batchId: string }).batchId;
  await vi.waitFor(() => expect(harness?.children[1]?.session.isStreaming).toBe(true));
  harness.children[1]?.finish("B findings.");
  await vi.waitFor(() =>
    expect(
      harness?.registry.snapshot().runs.find((run) => run.taskDescription === "Inspect B module.")
        ?.status,
    ).toBe("completed"),
  );
  return { batchId, conversationId };
}

async function continueConversation(conversationId: string, id: string) {
  if (!harness) throw new Error("Missing test harness.");
  return harness.invoke("agent_run", {
    mode: "foreground",
    tasks: [{ id, continue: { conversationId }, instructions: `Inspect ${id} module.` }],
  });
}

async function runFollowUp(conversationId: string, id: string, text: string): Promise<void> {
  if (!harness) throw new Error("Missing test harness.");
  const result = continueConversation(conversationId, id);
  const index = harness.children.length;
  await vi.waitFor(() => expect(harness?.children[index]?.session.isStreaming).toBe(true));
  const entries = harness.children[index]?.session.sessionManager.getEntries();
  expect(JSON.stringify(entries)).toContain(`Inspect ${id} module.`);
  harness.children[index]?.finish(text);
  await result;
}

function stripCheckpoints(result: { details: Record<string, unknown> }) {
  return {
    details: {
      ...result.details,
      tasks: (result.details.tasks as Array<Record<string, unknown>>).map(
        ({ checkpoint: _checkpoint, ...task }) => task,
      ),
    },
  };
}

function storedCollection() {
  if (!harness) return undefined;
  const entry = harness.manager
    .getBranch()
    .find(
      (item) =>
        item.type === "message" &&
        item.message.role === "toolResult" &&
        item.message.toolName === "agent_result",
    );
  return entry?.type === "message" && entry.message.role === "toolResult"
    ? entry.message
    : undefined;
}

function checkpointFrom(value: { details: unknown } | undefined) {
  return (
    value?.details as {
      tasks?: Array<{ checkpoint?: { checkpointId: string; parentCheckpointId: string | null } }>;
    }
  )?.tasks?.[0]?.checkpoint;
}

function lastAgentRunResult(): { details: unknown } | undefined {
  if (!harness) return undefined;
  const entry = harness.manager
    .getBranch()
    .filter(
      (item) =>
        item.type === "message" &&
        item.message.role === "toolResult" &&
        item.message.toolName === "agent_run",
    )
    .at(-1);
  return entry?.type === "message" && entry.message.role === "toolResult"
    ? { details: entry.message.details }
    : undefined;
}

async function expectBlockedFollowUp(
  conversationId: string,
  id: string,
  message: string,
): Promise<void> {
  if (!harness) throw new Error("Missing test harness.");
  const previousCount = harness.children.length;
  const attempt = continueConversation(conversationId, id);
  const outcome = await Promise.race([
    attempt.then(
      () => "resolved",
      (error: unknown) => {
        expect(error).toMatchObject({ message: expect.stringContaining(message) });
        return "rejected";
      },
    ),
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50)),
  ]);
  if (outcome === "pending") {
    await vi.waitFor(() => expect(harness?.children).toHaveLength(previousCount + 1));
    harness.children.at(-1)?.finish("Unexpected run completed.");
    await attempt;
  }
  expect(outcome).toBe("rejected");
  expect(harness.children).toHaveLength(previousCount);
}
