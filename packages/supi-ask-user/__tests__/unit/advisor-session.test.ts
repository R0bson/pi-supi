import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdvisorReport, AdvisorRunner } from "../../src/advisor/types.ts";
import { FormAdvisor } from "../../src/session/advisor.ts";
import { AskUserController } from "../../src/session/controller.ts";
import { advisorForm, advisorReport, deferred, settleAdvisor } from "../helpers/advisor.ts";

const sessions: FormAdvisor[] = [];
function create(runner: AdvisorRunner) {
  const changed = vi.fn();
  const session = new FormAdvisor(runner, advisorForm, changed);
  sessions.push(session);
  return { session, changed };
}
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.useRealTimers();
});

describe("form advisor lifecycle", () => {
  it("has no feature timeout and stops its repaint timer on completion", async () => {
    vi.useFakeTimers();
    const pending = deferred<AdvisorReport>();
    const { session, changed } = create(() => pending.promise);
    session.start();
    await settleAdvisor();
    vi.advanceTimersByTime(300_000);
    expect(session.state.status).toBe("working");
    expect(changed.mock.calls.length).toBeGreaterThan(1);
    pending.resolve(advisorReport());
    await settleAdvisor();
    expect(session.state.status).toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels superseded requests, snapshots explicit refresh answers and ignores late results", async () => {
    const first = deferred<AdvisorReport>();
    const second = deferred<AdvisorReport>();
    const runner = vi
      .fn<AdvisorRunner>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { session } = create(runner);
    session.start();
    await settleAdvisor();
    const controller = new AskUserController(advisorForm);
    const outcome = controller.outcome();
    session.start(outcome);
    outcome.responses.length = 0;
    await settleAdvisor();
    expect(runner.mock.calls[0][2]?.aborted).toBe(true);
    expect(runner.mock.calls[1][1]?.responses).toHaveLength(2);
    second.resolve(advisorReport());
    await settleAdvisor();
    first.reject(new Error("late error"));
    await settleAdvisor();
    expect(session.state.status).toBe("ready");
    expect(session.state.report?.recommendations).toHaveLength(2);
  });

  it("keeps previous advice during refresh and exposes only sanitized failure messages", async () => {
    const runner = vi
      .fn<AdvisorRunner>()
      .mockResolvedValueOnce(advisorReport())
      .mockRejectedValueOnce(new Error("apiKey=secret"));
    const { session } = create(runner);
    session.start();
    await settleAdvisor();
    session.start(new AskUserController(advisorForm).outcome());
    expect(session.state.status).toBe("working");
    expect(session.state.report).toBeDefined();
    await settleAdvisor();
    expect(session.state.status).toBe("error");
    expect(session.state.error).not.toContain("secret");
  });

  it("disposal aborts work and prevents late results and further repaint callbacks", async () => {
    vi.useFakeTimers();
    const pending = deferred<AdvisorReport>();
    const runner = vi.fn<AdvisorRunner>(() => pending.promise);
    const { session, changed } = create(runner);
    session.start();
    await settleAdvisor();
    session.dispose();
    expect(runner.mock.calls[0][2]?.aborted).toBe(true);
    const calls = changed.mock.calls.length;
    pending.resolve(advisorReport());
    await settleAdvisor();
    vi.advanceTimersByTime(5000);
    expect(changed).toHaveBeenCalledTimes(calls);
    expect(session.state.report).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
