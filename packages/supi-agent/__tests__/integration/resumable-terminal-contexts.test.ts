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
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("terminal Agent Run context", () => {
  it("continues valid context after cancellation", async () => {
    harness = await backgroundHarness(sdk);
    const conversationId = await saveA();
    const parent = await harness.beginParent();
    const canceledRun = harness.invoke("agent_run", {
      mode: "foreground",
      tasks: [{ id: "B", continue: { conversationId }, instructions: "Inspect B module." }],
    });
    await vi.waitFor(() => expect(harness?.children[1]?.session.isStreaming).toBe(true));
    harness.children[1]?.bill("B stopped while the work was incomplete.");
    parent.abort();
    const canceled = await canceledRun;
    await harness.endParent(true);
    const checkpointB = taskCheckpoint(canceled);
    expect((canceled.details as { tasks: Array<{ status: string }> }).tasks[0]?.status).toBe(
      "canceled",
    );
    expect(checkpointB?.runStatus).toBe("canceled");

    await continueAfterTerminal(conversationId, "C", "canceled");
    expect(taskCheckpoint(lastAgentRun())?.parentCheckpointId).toBe(checkpointB?.checkpointId);
  });

  it("continues valid context after timeout", async () => {
    vi.useFakeTimers();
    harness = await backgroundHarness(sdk, { timeoutMinutes: 1 });
    const conversationId = await saveA();
    const timedRun = harness.invoke("agent_run", {
      mode: "foreground",
      tasks: [{ id: "B", continue: { conversationId }, instructions: "Inspect B module." }],
    });
    await vi.waitFor(() => expect(harness?.children[1]?.session.isStreaming).toBe(true));
    harness.children[1]?.bill("B stopped when the run reached its time limit.");
    await vi.advanceTimersByTimeAsync(60_000);
    const timedOut = await timedRun;
    const checkpointB = taskCheckpoint(timedOut);
    expect((timedOut.details as { tasks: Array<{ status: string }> }).tasks[0]?.status).toBe(
      "timeout",
    );
    expect(checkpointB?.runStatus).toBe("timeout");
    vi.useRealTimers();

    await continueAfterTerminal(conversationId, "C", "timeout");
    expect(taskCheckpoint(lastAgentRun())?.parentCheckpointId).toBe(checkpointB?.checkpointId);
  }, 10_000);
});

async function saveA(): Promise<string> {
  if (!harness) throw new Error("Missing test harness.");
  const run = harness.invoke("agent_run", {
    mode: "foreground",
    tasks: [{ id: "A", new: { profile: "explore" }, instructions: "Inspect A module." }],
  });
  await vi.waitFor(() => expect(harness?.children[0]?.session.isStreaming).toBe(true));
  harness.children[0]?.finish("A findings.");
  const result = await run;
  const conversationId = (result.details as { tasks: Array<{ conversationId: string }> }).tasks[0]
    ?.conversationId;
  if (!conversationId) throw new Error("Missing saved conversation.");
  return conversationId;
}

async function continueAfterTerminal(
  conversationId: string,
  id: string,
  previousStatus: string,
): Promise<void> {
  if (!harness) throw new Error("Missing test harness.");
  const run = harness.invoke("agent_run", {
    mode: "foreground",
    tasks: [{ id, continue: { conversationId }, instructions: `Inspect ${id} module.` }],
  });
  const index = harness.children.length;
  await vi.waitFor(() => expect(harness?.children[index]?.session.isStreaming).toBe(true));
  const prompt = harness.children[index]?.session.prompt.mock.calls[0]?.[0] ?? "";
  expect(prompt).toContain(`previous Agent Run ended ${previousStatus}`);
  expect(prompt).toContain("Do not replay interrupted actions");
  expect(JSON.stringify(harness.children[index]?.session.sessionManager.getEntries())).toContain(
    `Inspect ${id} module.`,
  );
  harness.children[index]?.finish(`${id} findings.`);
  await run;
}

function taskCheckpoint(result: { details: unknown }) {
  return (
    result.details as {
      tasks: Array<{
        checkpoint?: {
          checkpointId: string;
          parentCheckpointId: string | null;
          runStatus: string;
        };
      }>;
    }
  ).tasks[0]?.checkpoint;
}

function lastAgentRun(): { details: unknown } {
  if (!harness) throw new Error("Missing test harness.");
  const entry = harness.manager
    .getBranch()
    .filter(
      (item) =>
        item.type === "message" &&
        item.message.role === "toolResult" &&
        item.message.toolName === "agent_run",
    )
    .at(-1);
  if (entry?.type !== "message" || entry.message.role !== "toolResult") {
    throw new Error("Missing stored Agent Run result.");
  }
  return { details: entry.message.details };
}
