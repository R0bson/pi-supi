import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import { type ExtensionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { makeCtx } from "@mrclrchtr/supi-test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdvisorRunner } from "../../src/advisor/runner.ts";
import { ADVISOR_DEFAULTS } from "../../src/advisor/settings.ts";
import { normalizeQuestionnaire } from "../../src/normalize.ts";

const mocks = vi.hoisted(() => ({ complete: vi.fn(), config: vi.fn() }));
vi.mock("@mrclrchtr/supi-core/llm", () => ({ completeSimpleModelRequest: mocks.complete }));
vi.mock("../../src/advisor/settings.ts", async (original) => {
  const module = await original<typeof import("../../src/advisor/settings.ts")>();
  return { ...module, loadAdvisorConfig: mocks.config };
});
const form = normalizeQuestionnaire({
  questions: [{ id: "q", type: "text", header: "Q", prompt: "What now?" }],
});
const recommendation = {
  questionId: "q",
  kind: "text",
  text: "One small step",
  rationale: "Enough",
};
function final(): AssistantMessage {
  return {
    role: "assistant",
    api: "openai-responses",
    provider: "openai",
    model: "gpt-6.1-sol",
    timestamp: 0,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    content: [{ type: "text", text: JSON.stringify({ recommendations: [recommendation] }) }],
  };
}
function toolBatch(count = 1): AssistantMessage {
  return {
    ...final(),
    stopReason: "toolUse",
    content: Array.from({ length: count }, (_, i) => ({
      type: "toolCall",
      id: `call-${i}`,
      name: "advisor_read",
      arguments: { path: "source.ts" },
    })),
  };
}
function branch(content: string) {
  const session = SessionManager.inMemory("/project");
  session.appendMessage({ role: "user", content, timestamp: 1 });
  return session.getBranch();
}
let cwd: string;
let ctx: ExtensionContext;
let abort: AbortController;
let find: ReturnType<typeof vi.fn>;
let snapshot: ReturnType<typeof vi.fn>;
let requests: Context[];
beforeEach(async () => {
  vi.clearAllMocks();
  cwd = await mkdtemp(join(tmpdir(), "advisor-run-"));
  await writeFile(join(cwd, "source.ts"), "local evidence");
  abort = new AbortController();
  find = vi.fn(() => ({ provider: "openai", id: "gpt-6.1-sol" }));
  snapshot = vi.fn(() => branch("Current task"));
  ctx = makeCtx({
    cwd,
    signal: abort.signal,
    modelRegistry: { find },
    sessionManager: { getBranch: snapshot },
  }) as unknown as ExtensionContext;
  mocks.config.mockReturnValue({ ...ADVISOR_DEFAULTS });
  requests = [];
  mocks.complete.mockImplementation(async (_ctx, _model, context) => {
    requests.push(structuredClone(context));
    return final();
  });
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("advisor runner", () => {
  it("is lazy, fixed-profile, and independent of the parent tool set and active model", async () => {
    const runner = createAdvisorRunner(ctx);
    expect(find).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    const report = await runner(form);
    expect(find).toHaveBeenCalledExactlyOnceWith("openai", "gpt-6.1-sol");
    expect(report.profile).toEqual({
      provider: "openai",
      model: "gpt-6.1-sol",
      reasoning: "medium",
    });
    expect(requests[0].tools?.map((tool) => tool.name)).toEqual([
      "advisor_read",
      "advisor_list",
      "advisor_search",
    ]);
    expect(mocks.complete.mock.calls[0][3]).toMatchObject({
      reasoning: "medium",
      affinityScope: "ask-user-advisor",
    });
    expect(mocks.complete.mock.calls[0][3]).not.toHaveProperty("timeout");
  });

  it("snapshots the full branch afresh without truncation and includes only explicitly supplied refresh answers", async () => {
    snapshot.mockReturnValue(branch("x".repeat(50000)));
    const runner = createAdvisorRunner(ctx);
    await runner(form);
    const first = JSON.stringify(requests[0].messages);
    expect(first).toContain("x".repeat(50000));
    expect(first).not.toContain("SESSION CONTEXT TRUNCATED");
    expect(first).not.toContain("outcomeSnapshot");
    snapshot.mockReturnValue(branch("Refreshed task"));
    await runner(form, {
      outcome: "needs_discussion",
      responses: [],
      comment: "My current answer",
    });
    expect(JSON.stringify(requests[1].messages)).toContain("My current answer");
    expect(JSON.stringify(requests[1].messages)).toContain("Refreshed task");
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it("enforces six tool-call turns, then allows a tool-free final completion", async () => {
    let calls = 0;
    mocks.complete.mockImplementation(async (_ctx, _model, context) => {
      requests.push(structuredClone(context));
      return calls++ < 6 ? toolBatch() : final();
    });
    await createAdvisorRunner(ctx)(form);
    expect(requests).toHaveLength(7);
    expect(requests[6].tools).toEqual([]);
    expect(requests[6].messages.filter((message) => message.role === "toolResult")).toHaveLength(6);
  });

  it("executes at most twenty calls even when a single batch exceeds the budget", async () => {
    mocks.complete.mockImplementationOnce(async () => toolBatch(23));
    await createAdvisorRunner(ctx)(form);
    const results = requests[0].messages.filter((message) => message.role === "toolResult");
    expect(results.filter((result) => !result.isError)).toHaveLength(20);
    expect(results.filter((result) => result.isError)).toHaveLength(3);
    expect(requests[0].tools).toEqual([]);
  });

  it("supports zero tools and rejects further tool requests after budget exhaustion", async () => {
    mocks.config.mockReturnValue({ ...ADVISOR_DEFAULTS, maxToolCalls: 0 });
    await createAdvisorRunner(ctx)(form);
    expect(requests[0].tools).toEqual([]);
    mocks.complete.mockResolvedValue(toolBatch());
    await expect(createAdvisorRunner(ctx)(form)).rejects.toThrow("could not produce");
  });

  it("validates evidence only from this run's actual local reads", async () => {
    mocks.complete.mockResolvedValueOnce(toolBatch()).mockResolvedValueOnce({
      ...final(),
      content: [
        {
          type: "text",
          text: JSON.stringify({
            recommendations: [{ ...recommendation, evidence: [{ path: "source.ts" }] }],
          }),
        },
      ],
    });
    expect((await createAdvisorRunner(ctx)(form)).recommendations[0].evidence).toEqual([
      { path: "source.ts" },
    ]);
    mocks.complete.mockResolvedValue({
      ...final(),
      content: [
        {
          type: "text",
          text: JSON.stringify({
            recommendations: [{ ...recommendation, evidence: [{ path: "source.ts" }] }],
          }),
        },
      ],
    });
    await expect(createAdvisorRunner(ctx)(form)).rejects.toThrow("could not produce");
  });
});

describe("advisor failures and cancellation", () => {
  it.each(["error", "aborted"])(
    "sanitizes provider stopReason %s and never retries",
    async (stopReason) => {
      mocks.complete.mockResolvedValue({
        ...final(),
        stopReason,
        errorMessage: "secret-provider-token",
      });
      await expect(createAdvisorRunner(ctx)(form)).rejects.toThrow(
        /^Ask User advisor could not produce/,
      );
      expect(mocks.complete).toHaveBeenCalledTimes(1);
    },
  );

  it("sanitizes rejected promises and missing models without fallback", async () => {
    mocks.complete.mockRejectedValue(new Error("Authorization: secret-token"));
    let error: unknown;
    try {
      await createAdvisorRunner(ctx)(form);
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).not.toContain("secret-token");
    expect(error).not.toHaveProperty("cause");
    find.mockReturnValue(undefined);
    await expect(createAdvisorRunner(ctx)(form)).rejects.toThrow("could not produce");
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });

  it("honors both parent and caller cancellation before work and after completion awaits", async () => {
    const caller = new AbortController();
    caller.abort("secret reason");
    await expect(createAdvisorRunner(ctx)(form, undefined, caller.signal)).rejects.toMatchObject({
      name: "AbortError",
      message: "Advisor cancelled.",
    });
    expect(find).not.toHaveBeenCalled();
    mocks.complete.mockImplementation(async () => {
      abort.abort("secret reason");
      return toolBatch();
    });
    await expect(createAdvisorRunner(ctx)(form)).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
});
