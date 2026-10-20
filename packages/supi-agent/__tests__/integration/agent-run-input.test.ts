import { type ToolCall, validateToolArguments } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getTool } from "@mrclrchtr/supi-test-utils";
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

describe("registered agent_run argument preparation", () => {
  it.each([
    { new: { profile: "explore" }, continue: { conversationId: "saved" } },
    {},
    { profile: "explore" },
  ])("explains invalid selectors before schema validation: %j", async (selectors) => {
    harness = await backgroundHarness(sdk);
    const tool = getTool(harness.pi, "agent_run") as ToolDefinition;
    const input = {
      tasks: [task("valid"), { id: "invalid", instructions: "Inspect.", ...selectors }],
    };
    const expected = "Invalid agent_run task at tasks[1]. Choose exactly one of new or continue.";
    expect(() => validate(tool, input)).toThrow(expected);
    await expect(harness.invoke("agent_run", input)).rejects.toThrow(expected);
    expect(harness.children).toHaveLength(0);
  });

  it.each([
    { new: { profile: "explore" } },
    { continue: { conversationId: "saved" } },
    { new: { profile: "explore" }, continue: null },
    { new: null, continue: { conversationId: "saved" } },
  ])("preserves valid selectors and Pi optional-null handling: %j", async (selectors) => {
    harness = await backgroundHarness(sdk);
    const tool = getTool(harness.pi, "agent_run") as ToolDefinition;
    const input = { tasks: [{ id: "valid", instructions: "Inspect.", ...selectors }] };
    const before = structuredClone(input);
    expect(tool.prepareArguments?.(input)).toBe(input);
    expect(() => validate(tool, input)).not.toThrow();
    expect(input).toEqual(before);
    expect(harness.children).toHaveLength(0);
  });

  it.each([
    { tasks: [null] },
    { tasks: 1 },
    { tasks: [{ id: "invalid", instructions: "Inspect.", new: {} }] },
    { tasks: [{ id: "invalid", instructions: "Inspect.", new: { profile: "missing" } }] },
  ])("keeps schema validation for other invalid input: %j", async (input) => {
    harness = await backgroundHarness(sdk);
    const tool = getTool(harness.pi, "agent_run") as ToolDefinition;
    expect(tool.prepareArguments?.(input)).toBe(input);
    expect(() => validate(tool, input)).toThrow('Validation failed for tool "agent_run"');
    expect(harness.children).toHaveLength(0);
  });
});

function validate(tool: ToolDefinition, input: Record<string, unknown>): unknown {
  return validateToolArguments(tool, {
    type: "toolCall",
    id: "call-validation",
    name: tool.name,
    arguments: (tool.prepareArguments?.(input) ?? input) as ToolCall["arguments"],
  });
}
