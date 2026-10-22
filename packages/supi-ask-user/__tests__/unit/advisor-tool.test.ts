import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiMock, getTool, makeCtx } from "@mrclrchtr/supi-test-utils";
import { describe, expect, it, vi } from "vitest";
import askUserExtension from "../../src/ask-user.ts";
import type { AskUserToolDetails } from "../../src/types.ts";
import { advisorReport, settleAdvisor } from "../helpers/advisor.ts";
import { makeFormCtx } from "../helpers/index.ts";

const mocks = vi.hoisted(() => ({ runner: vi.fn(), create: vi.fn() }));
vi.mock("../../src/advisor/runner.ts", () => ({ createAdvisorRunner: mocks.create }));

const request = {
  questions: [
    {
      id: "choice",
      type: "choice",
      header: "Choice",
      prompt: "Pick",
      recommendation: "a",
      options: [
        { value: "a", label: "First" },
        { value: "b", label: "Second" },
      ],
    },
  ],
};

async function setup() {
  const pi = createPiMock() as unknown as ReturnType<typeof createPiMock> & ExtensionAPI;
  askUserExtension(pi);
  const ctx = makeCtx({ hasUI: true, mode: "tui" });
  Object.assign(ctx.sessionManager, { getSessionId: () => "advisor-tool-test" });
  for (const handler of pi.getHandlers("session_start"))
    await (handler as (...args: unknown[]) => unknown)({}, ctx);
  return { pi, tool: getTool(pi, "ask_user") };
}

describe("automatic advisor tool adapter", () => {
  it("starts advice in the real registered tool and persists only the user's chosen answer", async () => {
    const report = advisorReport();
    report.recommendations.pop();
    mocks.runner.mockResolvedValue(report);
    mocks.create.mockReturnValue(mocks.runner);
    const { pi, tool } = await setup();
    const fixture = makeFormCtx({ terminalRows: 80 });
    Object.assign(fixture.ctx, { hasUI: true, mode: "tui" });
    const pending = tool.execute("advisor-call", request, undefined, undefined, fixture.ctx);
    await settleAdvisor();
    expect(mocks.create).toHaveBeenCalledWith(fixture.ctx);
    expect(mocks.runner).toHaveBeenCalledTimes(1);
    expect(fixture.captured.value?.render(140).join("\n")).toContain("Advisor: ready");
    fixture.captured.value?.handleInput?.("\u001ba");
    fixture.captured.value?.handleInput?.("\r");
    fixture.captured.value?.handleInput?.("\r");
    const result = (await pending) as { details: AskUserToolDetails };
    expect(result.details).toMatchObject({
      responses: [{ answer: { options: [{ value: "b", selected: true }] } }],
    });
    expect(JSON.stringify(result)).not.toContain("Small reversible step");
    expect(pi.appendEntry).toHaveBeenCalledWith(
      "ask_user",
      expect.not.objectContaining({ recommendations: expect.anything() }),
    );
  });
});
