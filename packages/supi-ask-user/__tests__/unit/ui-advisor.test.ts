import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdvisorReport, AdvisorRunner } from "../../src/advisor/types.ts";
import type { AskUserFormUi } from "../../src/form-api.ts";
import { openAskUserForm } from "../../src/form-api.ts";
import type { AskUserOutcome, NormalizedQuestionnaire } from "../../src/types.ts";
import { advisorForm, advisorReport, deferred, settleAdvisor } from "../helpers/advisor.ts";
import { makeFormCtx } from "../helpers/index.ts";

const cleanups: Array<() => Promise<void>> = [];

function open(runner?: AdvisorRunner, questionnaire = advisorForm) {
  const fixture = makeFormCtx({ terminalRows: 100 });
  const abort = new AbortController();
  const result = openAskUserForm(questionnaire, {
    ui: fixture.ctx.ui as unknown as AskUserFormUi,
    advisor: runner,
    signal: abort.signal,
  });
  const component = fixture.captured.value;
  if (!component) throw new Error("Form did not open");
  cleanups.push(async () => {
    abort.abort();
    await result;
  });
  return {
    ...fixture,
    component,
    result,
    abort,
    input: (key: string) => component.handleInput?.(key),
    render: (width = 140) => component.render(width).join("\n"),
    submit: async () => {
      for (let i = 0; i < questionnaire.questions.length; i++) component.handleInput?.("\t");
      component.handleInput?.("\r");
      return result as Promise<AskUserOutcome>;
    },
  };
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("advisor form integration", () => {
  it("preserves the ordinary form when the API does not opt in", () => {
    const form = open();
    expect(form.render()).toContain("[recommended]");
    expect(form.render()).toContain("First option details");
    expect(form.render()).not.toContain("Advisor");
  });

  it("opens immediately, publishes one report and preserves answer, focus and details", async () => {
    const pending = deferred<AdvisorReport>();
    const runner = vi.fn<AdvisorRunner>(() => pending.promise);
    const form = open(runner);
    expect(form.render()).toContain("Advisor: working");
    form.input("\u001b[B");
    expect(form.render()).toContain("Second option details");
    pending.resolve(advisorReport());
    await settleAdvisor();
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][1]).toBeUndefined();
    expect(form.render()).toContain("Advisor: ready");
    expect(form.render()).toContain("Second option details");
    expect(form.render()).toContain("[advisor]");
    expect(form.render()).toContain("Your answer: First");
    expect(form.render()).toContain("On the question: Do not expand scope");
    form.input("\t");
    expect(form.render()).toContain("Suggested answer");
    expect(form.render()).toContain("Your answer: Original");
  });

  it("applies an existing choice without advancing and keeps advisor reasoning out of the result", async () => {
    const form = open(async () => advisorReport());
    await settleAdvisor();
    form.input("\u001ba");
    expect(form.render()).toContain("Matches your current answer");
    expect(form.render()).toContain("Question 1/2");
    const result = await form.submit();
    const answer = result.responses[0].answer;
    expect(
      answer.kind === "choice" && answer.options.filter((o) => o.selected).map((o) => o.value),
    ).toEqual(["b"]);
    expect(JSON.stringify(result)).not.toContain("Small reversible step");
    expect(result.responses[0].questionComment).toBeUndefined();
  });

  it("applies proposed text without advancing or submitting", async () => {
    const form = open(async () => advisorReport());
    await settleAdvisor();
    form.input("\t");
    form.input("\u001ba");
    expect(form.render()).toContain("Question 2/2");
    expect(form.render()).toContain("Matches your current answer");
    const result = await form.submit();
    expect(result.responses[1].answer).toEqual({
      kind: "text",
      answered: true,
      value: "Suggested answer",
    });
  });

  it("preserves the editor's Alt+D delete-word binding and uses Alt+I for advisor details", async () => {
    const form = open(async () => advisorReport());
    await settleAdvisor();
    form.input("\t");
    form.input("\u0001");
    form.input("\u001bd");
    expect(form.render()).not.toContain("Reasoning: medium");
    form.input("\u001bi");
    expect(form.render()).toContain("Reasoning: medium");
    const result = await form.submit();
    expect(result.responses[1].answer.answered).toBe(false);
  });

  it("shows all suggestions in review and exposes expanded details and profile", async () => {
    const form = open(async () => advisorReport());
    await settleAdvisor();
    expect(form.render()).not.toContain("Expanded explanation");
    form.input("\u001bi");
    expect(form.render()).toContain("Expanded explanation");
    expect(form.render()).toContain("openai/gpt-6.1-sol");
    form.input("\t");
    form.input("\t");
    expect(form.render()).toContain("Advisor: Second");
    expect(form.render()).toContain("Advisor: Suggested answer");
    expect(form.render()).toContain("Submit form");
  });

  it("handles a partial report and errors without blocking submission", async () => {
    const report = advisorReport();
    report.recommendations.pop();
    report.missingQuestionIds = ["text"];
    const form = open(async () => report);
    await settleAdvisor();
    expect(form.render()).toContain("1 unavailable");
    form.input("\t");
    expect(form.render()).toContain("No valid advice for this question");
    expect((await form.submit()).outcome).toBe("submitted");
    const failed = open(async () => {
      throw new Error("secret provider credential");
    });
    await settleAdvisor();
    expect(failed.render()).toContain("Advisor: unavailable");
    expect(failed.render()).not.toContain("secret provider credential");
    expect((await failed.submit()).outcome).toBe("submitted");
  });

  it("opens an outside option in a draft comment and preserves existing text on discard", async () => {
    const report = advisorReport();
    report.recommendations[0] = {
      questionId: "choice",
      kind: "alternative",
      text: "Try a short experiment",
      rationale: "The available options miss the goal",
    };
    const form = open(async () => report);
    form.input("c");
    form.input("Existing comment");
    form.input("\r");
    await settleAdvisor();
    form.input("\u001ba");
    expect(form.render()).toContain("Try a short experiment");
    expect(form.render()).toContain("Existing comment");
    expect(form.render()).not.toContain("Alt+A");
    form.input("\u001b");
    const result = await form.submit();
    expect(result.responses[0].questionComment).toBe("Existing comment");
    expect(result.responses[0].answer).toMatchObject({ options: [{ value: "a", selected: true }] });
  });

  it("adopts an outside option only after saving its comment, without inventing a selection", async () => {
    const report = advisorReport();
    report.recommendations[0] = {
      questionId: "choice",
      kind: "alternative",
      text: "Try a short experiment",
      rationale: "Missing option",
    };
    const form = open(async () => report);
    await settleAdvisor();
    form.input("c");
    form.input("Existing comment");
    form.input("\r");
    form.input("\u001ba");
    form.input("\r");
    const result = await form.submit();
    expect(result.responses[0].questionComment).toBe("Existing comment\n\nTry a short experiment");
    expect(result.responses[0].answer).toMatchObject({ options: [{ value: "a", selected: true }] });
    expect(JSON.stringify(result)).not.toContain("Missing option");
  });

  it("snapshots edited answers for refresh and disables applying previous advice", async () => {
    const pending = deferred<AdvisorReport>();
    const runner = vi
      .fn<AdvisorRunner>()
      .mockResolvedValueOnce(advisorReport())
      .mockImplementationOnce(() => pending.promise);
    const form = open(runner);
    await settleAdvisor();
    form.input("\u001br");
    form.input("\u001ba");
    expect(form.render()).toContain("applying it is disabled");
    await settleAdvisor();
    expect(runner.mock.calls[1][1]?.responses[0].answer).toMatchObject({
      options: [{ value: "a", selected: true }],
    });
    pending.resolve(advisorReport());
    await settleAdvisor();
    expect(form.render()).toContain("Your answer: First");
  });

  it("allows submission while working and aborts the analysis before returning", async () => {
    const pending = deferred<AdvisorReport>();
    const runner = vi.fn<AdvisorRunner>(() => pending.promise);
    const form = open(runner);
    await settleAdvisor();
    expect((await form.submit()).outcome).toBe("submitted");
    expect(runner.mock.calls[0][2]?.aborted).toBe(true);
    pending.resolve(advisorReport());
    await settleAdvisor();
    expect(form.render()).not.toContain("Advisor: ready");
  });

  it("does not dispatch a second advisor when another form holds the shared lock", async () => {
    const pending = deferred<AdvisorReport>();
    const runner = vi.fn<AdvisorRunner>(() => pending.promise);
    const form = open(runner);
    await settleAdvisor();
    await expect(
      openAskUserForm(advisorForm, {
        ui: form.ctx.ui as unknown as AskUserFormUi,
        advisor: runner,
      }),
    ).rejects.toThrow("already in flight");
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("keeps focused Submit visible when an atomic report expands earlier review cards", async () => {
    const pending = deferred<AdvisorReport>();
    const questionnaire: NormalizedQuestionnaire = {
      questions: Array.from({ length: 10 }, (_, i) => ({
        ...structuredClone(advisorForm.questions[0]),
        id: `q${i}`,
      })),
    };
    const form = open(() => pending.promise, questionnaire);
    form.terminal.rows = 18;
    for (let i = 0; i < 10; i++) form.input("\t");
    expect(form.render()).toContain("Submit form");
    pending.resolve({
      ...advisorReport(),
      recommendations: questionnaire.questions.map((q) => ({
        questionId: q.id,
        kind: "choice",
        values: ["b"],
        rationale: "Proceed",
      })),
    });
    await settleAdvisor();
    expect(form.render()).toContain("Submit form");
    form.input("\r");
    expect(((await form.result) as AskUserOutcome).responses).toHaveLength(10);
  });

  it("keeps narrow and short terminals within their viewport bounds", async () => {
    const form = open(async () => advisorReport());
    await settleAdvisor();
    form.input("\u001bi");
    for (const rows of [5, 12, 25, 60]) {
      form.terminal.rows = rows;
      for (const width of [7, 30, 79, 120, 160]) {
        const lines = form.component.render(width);
        expect(lines.length).toBeLessThanOrEqual(rows);
        for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("replaces a multi answer exactly while preserving option and question comments", async () => {
    const questionnaire: NormalizedQuestionnaire = structuredClone(advisorForm);
    const choice = questionnaire.questions[0];
    if (choice.type !== "choice") throw new Error("fixture");
    choice.multi = true;
    const form = open(async () => advisorReport(), questionnaire);
    form.input("n");
    form.input("note");
    form.input("\r");
    form.input("c");
    form.input("question note");
    form.input("\r");
    await settleAdvisor();
    form.input("\u001ba");
    const result = await form.submit();
    expect(result.responses[0].questionComment).toBe("question note");
    expect(result.responses[0].answer).toMatchObject({
      options: [
        { value: "a", selected: false, comment: "note" },
        { value: "b", selected: true },
      ],
    });
  });
});
