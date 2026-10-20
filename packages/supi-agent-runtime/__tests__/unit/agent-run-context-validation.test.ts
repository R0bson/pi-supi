import { beforeEach, expect, it, vi } from "vitest";

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

import { type SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
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

const entry = (value: Record<string, unknown>): SessionEntry => value as unknown as SessionEntry;
const user = (id: string, parentId: string | null, content = "saved") =>
  entry({
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "user", content, timestamp: 1 },
  });
const context = (entries: SessionEntry[], leafId: string): AgentRunContext => ({ entries, leafId });

function begin(contextValue: AgentRunContext, captureContext = false) {
  createHarness(mocks);
  return startAgentRun({
    inputs: { ...inputs(), context: contextValue },
    prompt: "continue saved work",
    ...(captureContext ? { captureContext: true } : {}),
    completionResolver: () => "complete",
  });
}

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

beforeEach(() => vi.clearAllMocks());

it("preserves native tool, custom, and replacement payloads while dropping assistant transport diagnostics", async () => {
  const payload = {
    env: { token: "argument-token" },
    headers: { secret: "argument-secret" },
    diagnostics: [{ message: "tool-owned diagnostic" }],
  };
  const entries = [
    user("root", null),
    entry({
      type: "message",
      id: "assistant",
      parentId: "root",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-1",
            name: "inspect",
            arguments: {
              env: payload.env,
              headers: payload.headers,
              token: "argument-token",
              secret: "argument-secret",
              diagnostics: payload.diagnostics,
            },
          },
        ],
        api: "test-api",
        provider: "test-provider",
        model: "test-model",
        usage: usage(1),
        stopReason: "toolUse",
        timestamp: 2,
        diagnostics: [
          { type: "provider-response", timestamp: 3, error: { message: "raw diagnostic" } },
        ],
        deferred: {
          provider: "test-provider",
          modelId: "test-model",
          api: "test-api",
          id: "raw",
          data: { secret: "raw transport" },
        },
        errorMessage: "raw provider error",
        rawStopReason: "raw-provider-stop",
      },
    }),
    entry({
      type: "message",
      id: "tool-result",
      parentId: "assistant",
      timestamp: "2026-01-01T00:00:02.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "inspect",
        content: [{ type: "text", text: "result" }],
        details: payload,
        isError: false,
        timestamp: 4,
      },
    }),
    entry({
      type: "custom_message",
      id: "custom-message",
      parentId: "tool-result",
      timestamp: "2026-01-01T00:00:03.000Z",
      customType: "extension",
      content: [
        { type: "text", text: "custom", env: payload.env, diagnostics: payload.diagnostics },
      ],
      details: payload,
      display: true,
    }),
    entry({
      type: "context_edit",
      id: "edit",
      parentId: "custom-message",
      timestamp: "2026-01-01T00:00:04.000Z",
      targetId: "custom-message",
      replacement: {
        content: [
          {
            type: "text",
            text: "replacement",
            headers: payload.headers,
            secret: "replacement-secret",
          },
        ],
      },
    }),
    entry({
      type: "context_edit",
      id: "tool-edit",
      parentId: "edit",
      timestamp: "2026-01-01T00:00:04.500Z",
      targetId: "tool-result",
      replacement: { content: "tool result replacement" },
    }),
    entry({
      type: "compaction",
      id: "compact",
      parentId: "tool-edit",
      timestamp: "2026-01-01T00:00:05.000Z",
      summary: "summary",
      firstKeptEntryId: "tool-result",
      tokensBefore: 20,
    }),
    user("sibling-root", null, "sibling"),
    user("sibling-leaf", "sibling-root", "sibling branch"),
    entry({
      type: "branch_summary",
      id: "summary",
      parentId: "compact",
      timestamp: "2026-01-01T00:00:06.000Z",
      summary: "sibling branch summary",
      fromId: "sibling-leaf",
    }),
  ];
  const harness = createHarness(mocks);
  useRestoredManager(harness);

  const outcome = await startAgentRun({
    inputs: { ...inputs(), context: context(entries, "summary") },
    prompt: "continue saved work",
    captureContext: true,
    completionResolver: () => "complete",
  }).result;

  expect(outcome.kind).toBe("success");
  const captured = outcome.context;
  expect(captured?.entries.find((item) => item.id === "tool-result")).toMatchObject({
    message: { details: payload },
  });
  expect(captured?.entries.find((item) => item.id === "custom-message")).toMatchObject({
    content: [{ env: payload.env, diagnostics: payload.diagnostics }],
    details: payload,
  });
  expect(captured?.entries.find((item) => item.id === "edit")).toMatchObject({
    replacement: { content: [{ headers: payload.headers, secret: "replacement-secret" }] },
  });
  expect(captured?.entries.find((item) => item.id === "tool-edit")).toMatchObject({
    replacement: { content: "tool result replacement" },
  });
  expect(captured?.entries.find((item) => item.id === "assistant")).not.toMatchObject({
    message: expect.objectContaining({
      diagnostics: expect.anything(),
      deferred: expect.anything(),
      errorMessage: expect.anything(),
      rawStopReason: expect.anything(),
    }),
  });
  expect(JSON.stringify(captured)).toContain("argument-token");
  expect(JSON.stringify(captured)).toContain("argument-secret");
  expect(JSON.stringify(captured)).toContain("tool-owned diagnostic");
  expect(JSON.stringify(captured)).not.toContain("raw diagnostic");
  expect(JSON.stringify(captured)).not.toContain("raw transport");
  expect(JSON.stringify(captured)).not.toContain("raw provider error");
  expect(JSON.stringify(captured)).not.toContain("raw-provider-stop");
});

it("accepts native retain-none compaction through the public start API", async () => {
  const root = user("root", null);
  const compact = entry({
    type: "compaction",
    id: "compact",
    parentId: "root",
    timestamp: "2026-01-01T00:00:01.000Z",
    summary: "retained summary",
    firstKeptEntryId: "compact",
    tokensBefore: 10,
  });
  const harness = createHarness(mocks);
  useRestoredManager(harness);

  const outcome = await startAgentRun({
    inputs: { ...inputs(), context: context([root, compact], "compact") },
    prompt: "continue saved work",
    completionResolver: () => "complete",
  }).result;

  expect(outcome.kind).toBe("success");
  expect(harness.session.messages).toContainEqual(
    expect.objectContaining({ role: "compactionSummary", summary: "retained summary" }),
  );
});

it("restores a native branch summary created without a previous leaf", async () => {
  const manager = SessionManager.inMemory();
  manager.branchWithSummary(null, "Known project facts.");
  const harness = createHarness(mocks);
  useRestoredManager(harness);

  const outcome = await startAgentRun({
    inputs: {
      ...inputs(),
      context: { entries: manager.getEntries(), leafId: manager.getLeafId() },
    },
    prompt: "Continue with those facts.",
    completionResolver: () => "complete",
  }).result;

  expect(outcome.kind).toBe("success");
  expect(harness.session.messages).toContainEqual(
    expect.objectContaining({ role: "branchSummary", summary: "Known project facts." }),
  );
});

it.each([
  [
    "missing compaction boundary",
    [
      user("root", null),
      entry({
        type: "compaction",
        id: "compact",
        parentId: "root",
        timestamp: "2026-01-01T00:00:01.000Z",
        summary: "summary",
        firstKeptEntryId: "missing",
        tokensBefore: 10,
      }),
    ],
  ],
  [
    "off-ancestry compaction boundary",
    [
      user("root", null),
      user("other-root", null),
      entry({
        type: "compaction",
        id: "compact",
        parentId: "root",
        timestamp: "2026-01-01T00:00:01.000Z",
        summary: "summary",
        firstKeptEntryId: "other-root",
        tokensBefore: 10,
      }),
    ],
  ],
  [
    "missing context edit target",
    [
      user("root", null),
      entry({
        type: "context_edit",
        id: "edit",
        parentId: "root",
        timestamp: "2026-01-01T00:00:01.000Z",
        targetId: "missing",
        replacement: null,
      }),
    ],
  ],
  [
    "off-branch context edit target",
    [
      user("root", null),
      user("other-root", null),
      user("other", "other-root"),
      entry({
        type: "context_edit",
        id: "edit",
        parentId: "root",
        timestamp: "2026-01-01T00:00:01.000Z",
        targetId: "other",
        replacement: null,
      }),
    ],
  ],
  [
    "ineligible context edit target",
    [
      user("root", null),
      entry({
        type: "model_change",
        id: "model",
        parentId: "root",
        timestamp: "2026-01-01T00:00:01.000Z",
        provider: "provider",
        modelId: "model",
      }),
      entry({
        type: "context_edit",
        id: "edit",
        parentId: "model",
        timestamp: "2026-01-01T00:00:02.000Z",
        targetId: "model",
        replacement: null,
      }),
    ],
  ],
  [
    "missing context edit replacement",
    [
      user("root", null),
      entry({
        type: "context_edit",
        id: "edit",
        parentId: "root",
        timestamp: "2026-01-01T00:00:01.000Z",
        targetId: "root",
      }),
    ],
  ],
  [
    "malformed context edit content",
    [
      user("root", null),
      entry({
        type: "context_edit",
        id: "edit",
        parentId: "root",
        timestamp: "2026-01-01T00:00:01.000Z",
        targetId: "root",
        replacement: { content: [{ type: "text", text: 5 }] },
      }),
    ],
  ],
] as const)("rejects %s before creating a session", (_name, entries) => {
  expect(() => begin(context([...entries], entries.at(-1)?.id ?? "root"))).toThrow(
    "Invalid Agent Run context",
  );
  expect(mocks.createAgentSession).not.toHaveBeenCalled();
});

it.each([
  ["malformed user content", { role: "user", content: [{ type: "text", text: 5 }], timestamp: 1 }],
  [
    "missing assistant model",
    {
      role: "assistant",
      content: [],
      api: "api",
      provider: "provider",
      usage: usage(1),
      stopReason: "stop",
      timestamp: 1,
    },
  ],
  [
    "malformed assistant usage",
    {
      role: "assistant",
      content: [],
      api: "api",
      provider: "provider",
      model: "model",
      usage: {},
      stopReason: "stop",
      timestamp: 1,
    },
  ],
  [
    "string assistant content",
    {
      role: "assistant",
      content: "saved answer",
      api: "api",
      provider: "provider",
      model: "model",
      usage: usage(1),
      stopReason: "stop",
      timestamp: 1,
    },
  ],
  ["malformed system content", { role: "system", content: 5, timestamp: 1 }],
] as const)("rejects %s before starting", (_name, message) => {
  const malformed = entry({
    type: "message",
    id: "bad",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message,
  });
  expect(() => begin(context([malformed], "bad"))).toThrow("Invalid Agent Run context");
  expect(mocks.createAgentSession).not.toHaveBeenCalled();
});

it("rejects malformed entry-level usage and compaction system checkpoints", () => {
  const malformedUsage = entry({
    type: "usage",
    id: "usage",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    kind: "nested",
    provider: "provider",
    model: "model",
    usage: { ...usage(1), cost: { total: "bad" } },
  });
  expect(() => begin(context([malformedUsage], "usage"))).toThrow("Invalid Agent Run context");

  const root = user("root", null);
  const malformedCheckpoint = entry({
    type: "compaction",
    id: "compact",
    parentId: "root",
    timestamp: "2026-01-01T00:00:01.000Z",
    summary: "summary",
    firstKeptEntryId: "compact",
    tokensBefore: 10,
    systemMessage: { role: "system", content: [{ type: "text", text: 5 }], timestamp: 2 },
  });
  expect(() => begin(context([root, malformedCheckpoint], "compact"))).toThrow(
    "Invalid Agent Run context",
  );
});
