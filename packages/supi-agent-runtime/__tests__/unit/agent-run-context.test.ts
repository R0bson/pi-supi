import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAgentSession: vi.fn(),
  createAgentSessionRuntime: vi.fn(),
  createModelRuntime: vi.fn(async () => ({
    getProviders: vi.fn(() => []),
    registerNativeProvider: vi.fn(),
    refresh: vi.fn(async () => undefined),
  })),
}));

vi.mock("@earendil-works/pi-coding-agent", async (original) => ({
  ...(await original()),
  ModelRuntime: { create: mocks.createModelRuntime },
  createAgentSession: mocks.createAgentSession,
  createAgentSessionRuntime: mocks.createAgentSessionRuntime,
}));

import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentRunContext } from "../../src/api.ts";
import { startAgentRun } from "../../src/api.ts";
import { createHarness, inputs } from "../helpers/agent-run-harness.ts";

const usage = (value: number) => ({
  input: value,
  output: value,
  cacheRead: value,
  cacheWrite: value,
  totalTokens: value * 4,
  cost: { input: value, output: value, cacheRead: value, cacheWrite: value, total: value * 4 },
});

function useRestoredManager(harness: ReturnType<typeof createHarness>): void {
  mocks.createAgentSessionRuntime.mockImplementation(async (factory, runtimeOptions) => {
    await factory(runtimeOptions);
    return harness.runtime;
  });
  mocks.createAgentSession.mockImplementation(async (sessionOptions) => {
    const manager = sessionOptions.sessionManager as SessionManager;
    harness.session.sessionManager = manager as never;
    harness.session.messages = manager.buildSessionContext().messages;
    return { session: harness.session, extensionsResult: { runtime: harness.extensionRuntime } };
  });
}

function savedContext(): AgentRunContext {
  const entry: SessionEntry = {
    type: "message",
    id: "saved",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "user", content: "saved request", timestamp: 1 },
  };
  return { entries: [entry], leafId: entry.id };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

it("restores detached native context and reports only new run usage", async () => {
  const harness = createHarness(mocks);
  mocks.createAgentSessionRuntime.mockImplementation(async (factory, runtimeOptions) => {
    await factory(runtimeOptions);
    return harness.runtime;
  });
  const historicalUser: SessionEntry = {
    type: "message",
    id: "root",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "user", content: "historical question", timestamp: 1 },
  };
  const entries: SessionEntry[] = [
    historicalUser,
    {
      type: "message",
      id: "assistant-old",
      parentId: "root",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "historical answer" }],
        provider: "test-provider",
        model: "test-model",
        api: "openai-completions",
        usage: usage(100),
        stopReason: "stop",
        timestamp: 2,
        diagnostics: [{ message: "private old diagnostic" }],
      } as never,
    },
    {
      type: "compaction",
      id: "compact-old",
      parentId: "assistant-old",
      timestamp: "2026-01-01T00:00:02.000Z",
      summary: "earlier findings",
      firstKeptEntryId: "assistant-old",
      tokensBefore: 100,
      usage: usage(20),
    },
    {
      type: "context_edit",
      id: "edit-old",
      parentId: "compact-old",
      timestamp: "2026-01-01T00:00:03.000Z",
      targetId: "assistant-old",
      replacement: { content: [{ type: "text", text: "edited historical answer" }] },
    },
    {
      type: "message",
      id: "other-branch",
      parentId: "root",
      timestamp: "2026-01-01T00:00:04.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "abandoned answer" }],
        api: "openai-completions",
        provider: "test-provider",
        model: "test-model",
        usage: usage(900),
        stopReason: "stop",
        timestamp: 3,
      } as never,
    },
  ];
  const context = { entries, leafId: "edit-old" };
  let restoredManager: SessionManager | undefined;
  let restoredMessages: readonly unknown[] = [];
  let finalLeafId: string | null | undefined;
  mocks.createAgentSession.mockImplementation(async (sessionOptions) => {
    restoredManager = sessionOptions.sessionManager as SessionManager;
    harness.session.sessionManager = restoredManager as never;
    restoredMessages = restoredManager.buildSessionContext().messages;
    harness.session.messages = [...restoredMessages] as never[];
    harness.session.prompt.mockImplementationOnce(async (_prompt, promptOptions) => {
      promptOptions?.preflightResult?.("started");
      const newAssistantId = restoredManager?.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "new answer" }],
        provider: "test-provider",
        model: "test-model",
        api: "openai-completions",
        usage: usage(3),
        stopReason: "stop",
        timestamp: 4,
      });
      if (newAssistantId) {
        restoredManager?.appendContextEdit(newAssistantId, {
          content: [{ type: "text", text: "edited new answer" }],
        });
      }
      harness.session.messages = restoredManager?.buildSessionContext().messages ?? [];
      harness.session.emit({ type: "turn_end" });
      restoredManager?.appendUsage("nested", "test-provider", "test-model", usage(5));
      restoredManager?.appendCompaction("new summary", "edit-old", 150, undefined, false, usage(7));
      finalLeafId = restoredManager?.getLeafId();
      harness.session.messages = restoredManager?.buildSessionContext().messages ?? [];
      harness.session.emit({ type: "agent_settled" });
    });
    return { session: harness.session, extensionsResult: { runtime: harness.extensionRuntime } };
  });
  harness.runtime.dispose.mockImplementationOnce(async () => {
    restoredManager?.appendUsage("shutdown", "test-provider", "test-model", usage(11));
    harness.session.dispose();
  });

  const run = startAgentRun({
    inputs: { ...inputs(), context },
    prompt: "continue this work",
    captureContext: true,
    completionResolver: () => "complete",
  });
  const progress = vi.fn();
  run.subscribe(progress);
  if (historicalUser.type !== "message" || historicalUser.message.role !== "user") {
    throw new Error("Expected a historical user message");
  }
  historicalUser.message.content = "mutated after start";
  entries.push({
    type: "message" as const,
    id: "late-input-entry",
    parentId: "edit-old",
    timestamp: "2026-01-01T00:00:05.000Z",
    message: { role: "user", content: "late input mutation", timestamp: 5 },
  });

  const outcome = await run.result;
  expect(outcome.kind).toBe("success");
  expect(restoredManager?.getEntry("root")).toMatchObject({
    message: { content: "historical question" },
  });
  expect(restoredManager?.getLeafId()).not.toBe("edit-old");
  expect(
    restoredManager
      ?.getBranch()
      .map((entry) => entry.id)
      .slice(0, 4),
  ).toEqual(["root", "assistant-old", "compact-old", "edit-old"]);
  expect(restoredManager?.getEntry("other-branch")).toBeDefined();
  expect(restoredMessages).toContainEqual(
    expect.objectContaining({ role: "compactionSummary", summary: "earlier findings" }),
  );
  expect(JSON.stringify(restoredMessages)).toContain("edited historical answer");
  expect(restoredMessages).not.toContainEqual(
    expect.objectContaining({
      content: [expect.objectContaining({ text: "historical answer" })],
    }),
  );
  expect(restoredManager?.buildContextEntries().map((entry) => entry.type)).toContain(
    "context_edit",
  );
  expect(mocks.createAgentSession).toHaveBeenCalledWith(
    expect.objectContaining({
      model: inputs().model,
      tools: ["read"],
      thinkingLevel: "low",
      sessionManager: restoredManager,
    }),
  );
  expect(harness.session.prompt).toHaveBeenCalledWith("continue this work", expect.any(Object));
  expect(outcome).toMatchObject({ usage: { input: 26 } });
  expect(progress.mock.calls.some(([snapshot]) => snapshot.usage?.input === 103)).toBe(false);
  expect(outcome.context?.leafId).toBe(finalLeafId);
  expect(outcome.context?.entries.map((entry) => entry.id)).toContain("other-branch");
  expect(outcome.context?.entries).not.toContainEqual(
    expect.objectContaining({ type: "usage", kind: "shutdown" }),
  );
  expect(JSON.stringify(outcome.context)).not.toContain("private old diagnostic");
  expect(outcome.context?.entries.find((entry) => entry.id === "assistant-old")).not.toMatchObject({
    message: { diagnostics: expect.anything() },
  });
  expect(JSON.stringify(outcome.context)).not.toContain("mutated after start");
  expect(JSON.stringify(outcome.context)).not.toContain("late-input-entry");
  const capturedContext = outcome.context;
  if (!capturedContext) throw new Error("Expected captured Agent Run context");
  const followupHarness = createHarness(mocks);
  useRestoredManager(followupHarness);
  let followupMessages: readonly unknown[] = [];
  mocks.createAgentSession.mockImplementation(async (sessionOptions) => {
    const manager = sessionOptions.sessionManager as SessionManager;
    followupHarness.session.sessionManager = manager as never;
    followupMessages = manager.buildSessionContext().messages;
    followupHarness.session.messages = [...followupMessages] as never[];
    followupHarness.session.prompt.mockImplementationOnce(async (_prompt, promptOptions) => {
      promptOptions?.preflightResult?.("started");
      manager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "follow-up answer" }],
        provider: "test-provider",
        model: "test-model",
        api: "openai-completions",
        usage: usage(2),
        stopReason: "stop",
        timestamp: 6,
      });
      followupHarness.session.messages = manager.buildSessionContext().messages;
      followupHarness.session.emit({ type: "agent_settled" });
    });
    return {
      session: followupHarness.session,
      extensionsResult: { runtime: followupHarness.extensionRuntime },
    };
  });
  const followup = startAgentRun({
    inputs: { ...inputs(), context: capturedContext },
    prompt: "follow up",
    completionResolver: () => "follow-up complete",
  });
  await expect(followup.result).resolves.toMatchObject({
    kind: "success",
    value: "follow-up complete",
    usage: { input: 2 },
  });
  expect(JSON.stringify(followupMessages)).toContain("new summary");
  expect(JSON.stringify(followupMessages)).toContain("edited new answer");
  expect(followupHarness.runtime.dispose).toHaveBeenCalledTimes(1);
  expect(outcome.context).not.toHaveProperty("dispose");
  expect(outcome.context).not.toHaveProperty("prompt");
  const capturedUser = outcome.context?.entries.find((entry) => entry.id === "root");
  if (capturedUser?.type === "message" && capturedUser.message.role === "user") {
    capturedUser.message.content = "mutated output context";
  }
  expect(restoredManager?.getEntry("root")).toMatchObject({
    message: { content: "historical question" },
  });
  expect(harness.runtime.dispose).toHaveBeenCalledTimes(1);
});

it.each(["failure", "cancel", "timeout"] as const)(
  "captures valid native context after a %s run",
  async (terminalKind) => {
    const harness = createHarness(mocks);
    useRestoredManager(harness);
    if (terminalKind === "timeout") vi.useFakeTimers();

    let releaseReadiness!: (ready: boolean) => void;
    let notifyReadiness!: () => void;
    const readinessStarted = new Promise<void>((resolve) => {
      notifyReadiness = resolve;
    });
    const readinessResult = new Promise<boolean>((resolve) => {
      releaseReadiness = resolve;
    });
    const liveAssistant = { role: "assistant", timestamp: 2, usage: usage(13) };
    if (terminalKind === "timeout") {
      harness.session.prompt.mockImplementationOnce(async (_prompt, promptOptions) => {
        promptOptions?.preflightResult?.("started");
        return new Promise<void>(() => {});
      });
    }
    const run = startAgentRun({
      inputs: { ...inputs(), context: savedContext() },
      prompt: "run with saved context",
      captureContext: true,
      ...(terminalKind === "failure"
        ? {
            readinessCheck: () => {
              harness.session.messages.push(liveAssistant);
              return false;
            },
          }
        : terminalKind === "cancel"
          ? {
              readinessCheck: async () => {
                Object.assign(harness.session.agent, {
                  state: { streamingMessage: liveAssistant },
                });
                notifyReadiness();
                return readinessResult;
              },
            }
          : { timeoutMs: 10 }),
      completionResolver: () => "complete",
    });

    if (terminalKind === "cancel") {
      await readinessStarted;
      const stopping = run.stop();
      releaseReadiness(true);
      await stopping;
    } else if (terminalKind === "timeout") {
      await vi.waitFor(() => expect(harness.session.prompt).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(10);
    }

    const outcome = await run.result;
    expect(outcome.kind).toBe(
      terminalKind === "failure" ? "failed" : terminalKind === "cancel" ? "canceled" : "timeout",
    );
    expect(outcome.context).toMatchObject({
      leafId: "saved",
      entries: [expect.objectContaining({ id: "saved" })],
    });
    if (terminalKind !== "timeout") expect(outcome.usage?.input).toBe(13);
  },
);

it("does not capture context unless the caller opts in", async () => {
  createHarness(mocks);
  const run = startAgentRun({
    inputs: inputs(),
    prompt: "ordinary run",
    completionResolver: () => "complete",
  });

  const outcome = await run.result;
  expect(outcome).not.toHaveProperty("context");
});

it("rejects a restored context with a missing leaf instead of starting fresh", () => {
  createHarness(mocks);
  expect(() =>
    startAgentRun({
      inputs: {
        ...inputs(),
        context: {
          entries: [
            {
              type: "message",
              id: "entry",
              parentId: null,
              timestamp: "2026-01-01T00:00:00.000Z",
              message: { role: "user", content: "saved", timestamp: 1 },
            },
          ],
          leafId: "missing-leaf",
        },
      },
      prompt: "must not start from an empty session",
      completionResolver: () => "complete",
    }),
  ).toThrow("Invalid Agent Run context");
  expect(mocks.createAgentSession).not.toHaveBeenCalled();
});
