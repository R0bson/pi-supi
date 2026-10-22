import { createPiMock, makeCtx } from "@mrclrchtr/supi-test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import tabSpinner from "../../src/tab-spinner.ts";

function setup() {
  const pi = createPiMock({ sessionName: "decision" });
  const setTitle = vi.fn();
  const ctx = makeCtx({ cwd: "/tmp", ui: { setTitle } });
  tabSpinner(pi as unknown as Parameters<typeof tabSpinner>[0]);
  const fire = async (event: string) => {
    for (const handler of pi.getHandlers(event)) await handler({}, ctx);
  };
  return { pi, setTitle, fire };
}

describe("tab spinner prompt ownership", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("ORCA_PANE_KEY", "");
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("leaves all title updates to Orca in managed panes", async () => {
    vi.stubEnv("ORCA_PANE_KEY", "pane");
    const { pi, fire, setTitle } = setup();
    await fire("session_start");
    await fire("agent_start");
    vi.advanceTimersByTime(160);
    await fire("ui_prompt_start");
    pi.events.emit("supi:review:brief-done", { kind: "success" });
    await fire("ui_prompt_end");
    await fire("agent_settled");
    vi.advanceTimersByTime(240);
    await fire("session_shutdown");
    expect(setTitle).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("holds needs-input across unrelated work and review events", async () => {
    const { pi, fire, setTitle } = setup();
    await fire("session_start");
    await fire("agent_start");
    await fire("ui_prompt_start");
    expect(setTitle).toHaveBeenLastCalledWith("● π - decision - tmp");
    setTitle.mockClear();
    pi.events.emit("supi:working:start", {});
    pi.events.emit("supi:review:brief-done", { kind: "success" });
    pi.events.emit("supi:working:end", {});
    vi.advanceTimersByTime(320);
    expect(setTitle).not.toHaveBeenCalled();
    await fire("ui_prompt_end");
    vi.advanceTimersByTime(80);
    expect(setTitle.mock.lastCall?.[0]).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] π/);
  });

  it("does not resume before both native and Ask User lifetimes close", async () => {
    const { pi, fire, setTitle } = setup();
    await fire("session_start");
    await fire("agent_start");
    await fire("ui_prompt_start");
    pi.events.emit("supi:ask-user:start", {});
    pi.events.emit("supi:ask-user:end", {});
    setTitle.mockClear();
    vi.advanceTimersByTime(160);
    expect(setTitle).not.toHaveBeenCalled();
    await fire("ui_prompt_end");
    vi.advanceTimersByTime(80);
    expect(setTitle).toHaveBeenCalledTimes(1);
  });

  it("preserves the prompt when work settles, then restores idle on close", async () => {
    const { fire, setTitle } = setup();
    await fire("session_start");
    await fire("agent_start");
    await fire("ui_prompt_start");
    setTitle.mockClear();
    await fire("agent_settled");
    vi.advanceTimersByTime(240);
    expect(setTitle).not.toHaveBeenCalled();
    await fire("ui_prompt_end");
    expect(setTitle).toHaveBeenLastCalledWith("π - decision - tmp");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up an open prompt on session replacement and shutdown", async () => {
    const { fire, setTitle } = setup();
    await fire("session_start");
    await fire("agent_start");
    await fire("ui_prompt_start");
    await fire("session_start");
    await fire("agent_start");
    vi.advanceTimersByTime(80);
    expect(setTitle.mock.lastCall?.[0]).toMatch(/^⠋ π/);
    await fire("ui_prompt_start");
    await fire("session_shutdown");
    expect(vi.getTimerCount()).toBe(0);
    expect(setTitle).toHaveBeenLastCalledWith("π - tmp");
  });
});
