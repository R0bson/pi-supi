import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import askUser from "@mrclrchtr/supi-ask-user/extension";
import { createPiMock, getTool, makeCtx } from "@mrclrchtr/supi-test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import tabSpinner from "../../src/tab-spinner.ts";

/** Compose both extensions; model Pi's coalesced outer-prompt lifecycle explicitly. */
async function setup() {
  const pi = createPiMock({ sessionName: "decision" });
  const setTitle = vi.fn();
  let finish: (value: unknown) => void = () => {};
  const ctx = makeCtx({
    hasUI: true,
    mode: "tui",
    cwd: "/tmp",
    abort: vi.fn(),
    ui: {
      setTitle,
      setWorkingVisible: vi.fn(),
      custom: (factory: (...args: unknown[]) => unknown) =>
        new Promise((resolve) => {
          finish = resolve;
          factory(
            { terminal: { rows: 40 }, requestRender() {} },
            { fg: (_color: string, text: string) => text },
            { matches: () => false },
            resolve,
          );
        }),
    },
  });
  Object.assign(ctx.sessionManager, { getSessionId: () => "sid-1" });
  askUser(pi as unknown as ExtensionAPI);
  tabSpinner(pi as unknown as ExtensionAPI);
  const fire = async (name: string) => {
    for (const handler of pi.getHandlers(name)) await handler({}, ctx);
  };
  await fire("session_start");
  await fire("agent_start");
  await fire("ui_prompt_start");
  const controller = new AbortController();
  const pending = getTool(pi, "ask_user").execute(
    "ask-1",
    { questions: [{ type: "text", id: "target", header: "Target", prompt: "Which target?" }] },
    controller.signal,
    undefined,
    ctx,
  );
  return { setTitle, fire, pending, controller, finish: (result: unknown) => finish(result) };
}

describe("Ask User cleanup inside an outer native prompt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("ORCA_PANE_KEY", "");
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(["submit", "cancel", "abort"])("preserves the outer prompt after %s", async (action) => {
    const { pending, finish, controller, setTitle, fire } = await setup();
    if (action === "submit") {
      finish({ outcome: "needs_discussion", responses: [] });
      await pending;
    } else {
      const rejected = expect(pending).rejects.toThrow("interaction was cancelled");
      if (action === "abort") controller.abort();
      else finish({ kind: "cancel" });
      await rejected;
    }
    expect(setTitle).toHaveBeenLastCalledWith("● π - decision - tmp");
    setTitle.mockClear();
    vi.advanceTimersByTime(240);
    expect(setTitle).not.toHaveBeenCalled();
    await fire("ui_prompt_end");
    vi.advanceTimersByTime(80);
    expect(setTitle.mock.lastCall?.[0]).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] π/);
    await fire("session_shutdown");
  });
});
