import { type ExtensionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { makeCtx } from "@mrclrchtr/supi-test-utils";
import { describe, expect, it } from "vitest";
import { snapshotAdvisorContext } from "../../src/advisor/context.ts";

function context(sessionManager: SessionManager): ExtensionContext {
  return makeCtx({ sessionManager }) as unknown as ExtensionContext;
}
function user(manager: SessionManager, content: string): string {
  return manager.appendMessage({ role: "user", content, timestamp: 1 });
}

describe("advisor full uncompacted branch snapshot", () => {
  it("retains original messages before multiple real compactions, without summary substitutions", () => {
    const manager = SessionManager.inMemory("/project");
    user(manager, "Original constraints before compaction");
    manager.appendCompaction("Lossy first summary", null, 10000);
    user(manager, "Intermediate decision");
    manager.appendCompaction("Lossy second summary", null, 12000);
    user(manager, "Current task");
    const originalEntries = JSON.stringify(manager.getBranch());
    const snapshot = snapshotAdvisorContext(context(manager));
    expect(snapshot).toContain("Original constraints before compaction");
    expect(snapshot).toContain("Intermediate decision");
    expect(snapshot).toContain("Current task");
    expect(snapshot).not.toContain("Lossy first summary");
    expect(snapshot).not.toContain("Lossy second summary");
    expect(JSON.stringify(manager.getBranch())).toEqual(originalEntries);
  });

  it("does not read sibling branches or substitute a branch summary for current-branch history", () => {
    const manager = SessionManager.inMemory("/project");
    const root = user(manager, "Shared root");
    user(manager, "Abandoned branch conversation");
    manager.branchWithSummary(root, "Summary of abandoned branch");
    user(manager, "Active branch conversation");
    const snapshot = snapshotAdvisorContext(context(manager));
    expect(snapshot).toContain("Shared root");
    expect(snapshot).toContain("Active branch conversation");
    expect(snapshot).not.toContain("Abandoned branch conversation");
    expect(snapshot).not.toContain("Summary of abandoned branch");
  });

  it("honors explicit context edits across compaction without changing stored history", () => {
    const manager = SessionManager.inMemory("/project");
    const replaced = user(manager, "Raw text must not leak");
    const omitted = user(manager, "Explicitly omitted secret");
    manager.appendContextEdit(replaced, {
      content: [{ type: "text", text: "Explicit replacement" }],
    });
    manager.appendContextEdit(omitted, null);
    manager.appendCompaction("Summary", null, 10000);
    const snapshot = snapshotAdvisorContext(context(manager));
    expect(snapshot).toContain("Explicit replacement");
    expect(snapshot).not.toContain("Raw text must not leak");
    expect(snapshot).not.toContain("Explicitly omitted secret");
  });

  it("includes ordinary Bash commands and output before compaction but honors excludeFromContext", () => {
    const manager = SessionManager.inMemory("/project");
    manager.appendMessage({
      role: "bashExecution",
      command: "git status --short",
      output: " M source.ts",
      exitCode: 0,
      cancelled: false,
      truncated: false,
      timestamp: 1,
    });
    manager.appendMessage({
      role: "bashExecution",
      command: "hidden-command",
      output: "Private command output",
      exitCode: 1,
      cancelled: false,
      truncated: false,
      excludeFromContext: true,
      timestamp: 2,
    });
    manager.appendCompaction("Summary", null, 1000);
    user(manager, "Continue");
    const snapshot = snapshotAdvisorContext(context(manager));
    expect(snapshot).toContain("git status --short");
    expect(snapshot).toContain(" M source.ts");
    expect(snapshot).not.toContain("hidden-command");
    expect(snapshot).not.toContain("Private command output");
  });

  it("includes long messages in full without character caps or automatic summaries", () => {
    const manager = SessionManager.inMemory("/project");
    user(manager, `Beginning ${"x".repeat(60000)} End of first message`);
    user(manager, `Next ${"y".repeat(60000)} End of second message`);
    const snapshot = snapshotAdvisorContext(context(manager));
    expect(snapshot).toContain(`Beginning ${"x".repeat(60000)} End of first message`);
    expect(snapshot).toContain(`Next ${"y".repeat(60000)} End of second message`);
    expect(snapshot).not.toContain("TRUNCATED");
  });

  it("includes tool calls, prior decisions and tool output, but not reasoning, binary or tool details", () => {
    const manager = SessionManager.inMemory("/project");
    manager.appendMessage({
      role: "assistant",
      api: "openai-responses",
      provider: "openai",
      model: "gpt-6.1-sol",
      timestamp: 1,
      stopReason: "toolUse",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      content: [
        { type: "thinking", thinking: "Private reasoning" },
        { type: "toolCall", id: "call", name: "read", arguments: { path: "source.ts" } },
      ],
    });
    manager.appendMessage({
      role: "toolResult",
      toolName: "read",
      toolCallId: "call",
      isError: false,
      timestamp: 2,
      content: [
        { type: "text", text: "Read evidence" },
        { type: "image", data: "Image bytes", mimeType: "image/png" },
      ],
      details: { hidden: "Secret details" },
    });
    manager.appendMessage({
      role: "toolResult",
      toolName: "ask_user",
      toolCallId: "previous",
      isError: false,
      timestamp: 3,
      content: [{ type: "text", text: "Previously accepted decisions" }],
    });
    const snapshot = snapshotAdvisorContext(context(manager));
    for (const visible of ["source.ts", "Read evidence", "Previously accepted decisions"])
      expect(snapshot).toContain(visible);
    for (const hidden of ["Private reasoning", "Image bytes", "Secret details"])
      expect(snapshot).not.toContain(hidden);
    expect(snapshot).toContain("binary data not included");
  });
});
