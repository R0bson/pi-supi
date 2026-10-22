import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiMock, makeCtx } from "@mrclrchtr/supi-test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AskUserExecutionContext, executeAskUser } from "../../src/tool/ask_user/execute.ts";

const request = {
  questions: [{ type: "text" as const, id: "target", header: "Target", prompt: "Which target?" }],
};

/** Exercise the real form factory and ownership callbacks, holding the UI open. */
function setup() {
  const pi = createPiMock();
  const setTitle = vi.fn();
  const setWorkingVisible = vi.fn();
  const abort = vi.fn();
  let finish: (result: unknown) => void = () => {};
  const ctx = makeCtx({
    hasUI: true,
    mode: "tui",
    abort,
    ui: {
      setTitle,
      setWorkingVisible,
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
  const pending = executeAskUser(
    request,
    undefined,
    ctx as unknown as AskUserExecutionContext,
    pi as unknown as ExtensionAPI,
  );
  return {
    pi,
    setTitle,
    setWorkingVisible,
    abort,
    pending,
    finish: (value: unknown) => finish(value),
  };
}

describe("Ask User in Orca-managed panes", () => {
  beforeEach(() => {
    vi.stubEnv("ORCA_PANE_KEY", "pane");
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("preserves Orca's title while still hiding local working UI and ringing the bell", async () => {
    const { pi, pending, finish, setTitle, setWorkingVisible } = setup();
    expect(setWorkingVisible).toHaveBeenLastCalledWith(false);
    expect(setTitle).not.toHaveBeenCalled();
    expect(process.stdout.write).toHaveBeenCalledWith("\x07");
    finish({ outcome: "needs_discussion", responses: [] });
    await pending;
    expect(setTitle).not.toHaveBeenCalled();
    expect(setWorkingVisible).toHaveBeenLastCalledWith(true);
    expect(pi.events.emit).toHaveBeenLastCalledWith("supi:ask-user:end", {
      source: "supi-ask-user",
    });
  });

  it.each(["cancel", "abort"])("cleans up %s without replacing Orca's title", async (kind) => {
    const { pending, finish, setTitle, setWorkingVisible, abort } = setup();
    finish({ kind });
    await expect(pending).rejects.toThrow("interaction was cancelled");
    expect(abort).toHaveBeenCalledOnce();
    expect(setWorkingVisible.mock.calls).toEqual([[false], [true]]);
    expect(setTitle).not.toHaveBeenCalled();
  });
});
