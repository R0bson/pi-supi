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

describe("delegation admission", () => {
  it("rejects an entire batch when active foreground and background runs fill capacity", async () => {
    harness = await backgroundHarness(sdk);
    const foreground = harness.invoke("agent_run", {
      tasks: [task("foreground")],
      mode: "foreground",
    });
    await harness.invoke("agent_run", { tasks: [task("a"), task("b")] });
    await expect(harness.invoke("agent_run", { tasks: [task("c"), task("d")] })).rejects.toThrow(
      /capacity/i,
    );
    await vi.waitFor(() =>
      expect(harness?.children.filter((child) => child.session.isStreaming)).toHaveLength(3),
    );
    harness.child("foreground").finish();
    await foreground;
    const accepted = await harness.invoke("agent_run", { tasks: [task("c"), task("d")] });
    expect(accepted.details.mode).toBe("background");
  });
});
