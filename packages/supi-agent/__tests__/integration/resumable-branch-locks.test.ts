import { afterEach, describe, expect, it, vi } from "vitest";
import { backgroundHarness } from "../helpers/background-harness.ts";

const sdk = vi.hoisted(() => ({ createAgentSession: vi.fn(), createAgentSessionRuntime: vi.fn() }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  ...sdk,
}));

let harness: Awaited<ReturnType<typeof backgroundHarness>> | undefined;
let releaseHeldDisposal: (() => void) | undefined;
afterEach(async () => {
  releaseHeldDisposal?.();
  await harness?.close();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("active conversation locks", () => {
  it("keeps an off-branch run busy until disposal settles", async () => {
    harness = await backgroundHarness(sdk);
    const firstRun = harness.invoke("agent_run", {
      mode: "foreground",
      tasks: [{ id: "A", new: { profile: "explore" }, instructions: "Inspect A module." }],
    });
    await vi.waitFor(() => expect(harness?.children[0]?.session.isStreaming).toBe(true));
    harness.children[0]?.finish("A findings.");
    const first = await firstRun;
    const conversationId = (first.details as { tasks: Array<{ conversationId: string }> }).tasks[0]
      ?.conversationId;
    const firstResultId = harness.manager
      .getBranch()
      .find(
        (entry) =>
          entry.type === "message" &&
          entry.message.role === "toolResult" &&
          entry.message.toolName === "agent_run",
      )?.id;

    const started = await harness.invoke("agent_run", {
      tasks: [{ id: "B", continue: { conversationId }, instructions: "Inspect B module." }],
    });
    await vi.waitFor(() => expect(harness?.children[1]?.session.isStreaming).toBe(true));
    releaseHeldDisposal = harness.child("B").holdDisposal();
    harness.manager.branch(firstResultId ?? "");
    await harness.pi.emit("session_tree", { type: "session_tree" }, harness.ctx);
    await vi.waitFor(() => expect(harness?.children[1]?.runtime.dispose).toHaveBeenCalled());

    const listed = await harness.invoke("agent_list", {});
    expect(listed.details).toMatchObject({
      rows: [expect.objectContaining({ conversationId, status: "busy", activity: "busy" })],
    });
    await expectRejectedWithoutStarting(conversationId, "C-too-soon", "active Agent Run");

    releaseHeldDisposal();
    await vi.waitFor(() =>
      expect(
        harness?.registry.snapshot().runs.find((run) => run.taskDescription === "Inspect B module.")
          ?.status,
      ).toBe("canceled"),
    );
    const followUp = harness.invoke("agent_run", {
      mode: "foreground",
      tasks: [{ id: "C", continue: { conversationId }, instructions: "Inspect C module." }],
    });
    await vi.waitFor(() => expect(harness?.children[2]?.session.isStreaming).toBe(true));
    const childEntries = harness.children[2]?.session.sessionManager.getEntries();
    expect(JSON.stringify(childEntries)).toContain("Inspect A module.");
    expect(JSON.stringify(childEntries)).not.toContain("Inspect B module.");
    harness.children[2]?.finish("C findings.");
    await followUp;
    expect(started.details).toMatchObject({ mode: "background" });
  }, 10_000);
});

async function expectRejectedWithoutStarting(
  conversationId: string,
  id: string,
  message: string,
): Promise<void> {
  if (!harness) throw new Error("Missing test harness.");
  const previousCount = harness.children.length;
  const attempt = harness.invoke("agent_run", {
    mode: "foreground",
    tasks: [{ id, continue: { conversationId }, instructions: `Inspect ${id} module.` }],
  });
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
