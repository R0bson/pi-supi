import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureDebugRegistry,
  getDebugEvents,
  resetDebugRegistry,
} from "@mrclrchtr/supi-core/debug";
import { createPiMock, makeCtx } from "@mrclrchtr/supi-test-utils";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAntigravityAdapter } from "../../src/agents/antigravity/adapter.ts";
import { getIsolatedAntigravityPaths } from "../../src/agents/antigravity/isolated-home.ts";
import type { ConsultingAgentExecutionOptions } from "../../src/agents/types.ts";
import { ConversationHandleStore } from "../../src/conversation/handles.ts";
import { registerConsultingRunTool } from "../../src/tool/consulting_run/register.ts";
import { fixtureDirectory } from "../helpers/test-paths.ts";

const fakeDirectory = fixtureDirectory(import.meta.dirname);
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "supi-consulting-failures-"));
  await chmod(join(fakeDirectory, "agy"), 0o755);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  vi.stubEnv("PI_CODING_AGENT_DIR", root);
  vi.stubEnv("PATH", `${fakeDirectory}:${process.env.PATH ?? ""}`);
  configureDebugRegistry({ enabled: true, agentAccess: "raw" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetDebugRegistry();
});

function execute(
  prompt: string,
  options: Pick<ConsultingAgentExecutionOptions, "signal" | "onProgress"> = {},
) {
  const paths = getIsolatedAntigravityPaths();
  return createAntigravityAdapter(paths).execute({
    prompt,
    model: "gemini-3.8-flash-low",
    canonicalWorkingDirectory: paths.consultationWorkspace,
    workspaceAccess: false,
    ...options,
  });
}

describe("Consultation failure diagnostics", () => {
  it.each([
    ["response-case=no-terminal", "missing-terminal", "did not return a final result"],
    ["response-case=terminal-error", "terminal-failed", "reported an unsuccessful final result"],
    ["response-case=missing-answer", "missing-answer", "did not return a final structured answer"],
    ["response-case=invalid-answer", "invalid-answer", "does not match the required schema"],
    ["response-case=missing-conversation", "missing-conversation", "conversation identifier"],
    ["response-case=trailing-event", "events-after-terminal", "data after its final result"],
    ["response-case=event-limit", "event-limit", "event limit"],
    ["malformed", "malformed-json", "malformed JSON"],
    ["non-object", "invalid-event", "non-object response event"],
    ["oversized", "stdout-line-limit", "line-size limit"],
    ["byte-limit", "stdout-byte-limit", "total output-size limit"],
  ])("reports %s without inventing a permission denial", async (prompt, reason, message) => {
    const failure = await execute(prompt).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      name: "ConsultingAgentError",
      kind: "invalid-response",
      reason,
      message: expect.stringContaining(message),
    });
    expect(String(failure)).not.toContain("permission denial");
    expect(getDebugEvents({ source: "consulting", level: "error" }).events).toMatchObject([
      { data: { kind: "invalid-response", reason, permissionDenials: 0 } },
    ]);
  });

  it.each([
    ["no-terminal", "missing-terminal"],
    ["terminal-error", "terminal-failed"],
    ["broken-tail", "malformed-json"],
  ])("keeps the failure reason after a denial: %s", async (scenario, reason) => {
    const failure = await execute(`denied-incomplete ${scenario}`).catch((error: unknown) => error);
    expect(failure).toMatchObject({ reason, diagnostics: { permissionDenials: 1 } });
    const events = getDebugEvents({
      source: "consulting",
      includeRaw: true,
      allowRaw: true,
    }).events;
    expect(events).toMatchObject([{ data: { reason, permissionDenials: 1 } }]);
    expect(JSON.stringify({ failure, events })).not.toMatch(
      /private output text|fixture-auth|private-image|private diagnostic text/,
    );
  });

  it("records cancellation separately even after a permission denial", async () => {
    const controller = new AbortController();
    let toolUpdates = 0;
    const failure = await execute("denied-incomplete wait", {
      signal: controller.signal,
      onProgress: (activity) => {
        if (activity === "activity: read_file" && ++toolUpdates === 2) controller.abort();
      },
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: "cancelled", diagnostics: { permissionDenials: 1 } });
    expect(getDebugEvents({ source: "consulting", level: "error" }).events).toEqual([]);
    expect(getDebugEvents({ source: "consulting" }).events).toMatchObject([
      {
        level: "info",
        category: "consultation.cancelled",
        data: { kind: "cancelled", reason: "cancelled", permissionDenials: 1 },
      },
    ]);
  });

  it("logs process exit facts without stderr and keeps successful denials non-fatal", async () => {
    await execute("permission");
    expect(getDebugEvents({ source: "consulting" }).events).toEqual([]);
    await expect(execute("exit-nonzero")).rejects.toMatchObject({
      kind: "execution",
      diagnostics: { exitCode: 7 },
    });
    const events = getDebugEvents({
      source: "consulting",
      includeRaw: true,
      allowRaw: true,
    }).events;
    expect(events).toMatchObject([{ data: { kind: "execution", exitCode: 7 } }]);
    expect(JSON.stringify(events)).not.toMatch(/stderr|fixture process failure/);
  });

  it("keeps the failure reason when Debug is disabled", async () => {
    configureDebugRegistry({ enabled: false });
    await expect(execute("denied-incomplete")).rejects.toMatchObject({
      reason: "missing-answer",
      diagnostics: { permissionDenials: 1 },
    });
    expect(getDebugEvents().events).toEqual([]);
  });

  it("returns the specific error through consulting_run without duplicate debug events", async () => {
    const paths = getIsolatedAntigravityPaths();
    const adapter = createAntigravityAdapter(paths);
    const availability = await adapter.discover();
    if (availability.status !== "available") throw new Error("Fixture discovery failed.");
    const pi = createPiMock();
    registerConsultingRunTool({
      pi: pi as never,
      adapter,
      availability,
      handles: new ConversationHandleStore(),
    });
    const tool = pi.tools[0] as { execute: (...args: unknown[]) => Promise<unknown> };
    await expect(
      tool.execute(
        "failure-test",
        {
          prompt: "denied-incomplete",
          new: { agent: "antigravity", model: "gemini-3.8-flash-low", workspace: true },
        },
        undefined,
        undefined,
        makeCtx({ cwd: paths.consultationWorkspace }),
      ),
    ).rejects.toThrow("did not return a final structured answer. A tool permission denial");
    expect(getDebugEvents({ source: "consulting", level: "error" }).events).toMatchObject([
      { data: { workspaceAccess: true, reason: "missing-answer", permissionDenials: 1 } },
    ]);
  });

  it("reports a missing answer and an observed denial without exposing private data", async () => {
    const failure = await execute("denied-incomplete private prompt text").catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      name: "ConsultingAgentError",
      kind: "invalid-response",
      reason: "missing-answer",
      message:
        "The Consulting Agent did not return a final structured answer. A tool permission denial was observed. Check the requested resources and the Consulting Agent permissions.",
    });
    const events = getDebugEvents({
      source: "consulting",
      includeRaw: true,
      allowRaw: true,
    }).events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: "error",
      category: "consultation.failed",
      data: {
        agent: "antigravity",
        model: "gemini-3.8-flash-low",
        workspaceAccess: false,
        followUp: false,
        phase: "conversation",
        kind: "invalid-response",
        reason: "missing-answer",
        permissionDenials: 1,
        eventCount: 4,
        terminalSeen: true,
        terminalSucceeded: true,
        timing: { durationMs: expect.any(Number) },
      },
    });
    expect(failure).not.toHaveProperty("cause");
    expect(failure).not.toHaveProperty("stderr");
    expect(events[0]).not.toHaveProperty("rawData");
    expect(JSON.stringify({ failure, events })).not.toMatch(
      /private prompt text|private diagnostic text|private-image|fixture-conversation/,
    );
  });
});
