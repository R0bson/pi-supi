import { describe, expect, it } from "vitest";
import { ADVISOR_DEFAULTS } from "../../src/advisor/settings.ts";
import { validateAdvisorReport } from "../../src/advisor/validation.ts";
import { normalizeQuestionnaire } from "../../src/normalize.ts";

const form = normalizeQuestionnaire({
  questions: [
    {
      id: "single",
      type: "choice",
      header: "One",
      prompt: "Choose",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    },
    {
      id: "multi",
      type: "choice",
      header: "Many",
      prompt: "Choose",
      multi: true,
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    },
    { id: "text", type: "text", header: "Text", prompt: "Explain" },
  ],
});
const choice = { questionId: "single", kind: "choice", values: ["a"], rationale: "Small step" };
const answer = { questionId: "text", kind: "text", text: "Try it", rationale: "Reversible" };
function parse(recommendations: unknown[], sources = new Set<string>()) {
  return validateAdvisorReport(
    JSON.stringify({ recommendations }),
    form,
    ADVISOR_DEFAULTS,
    sources,
  );
}

describe("advisor report validation", () => {
  it("accepts choices, text, optional metadata, and actually read evidence in question order", () => {
    const report = parse(
      [
        answer,
        {
          ...choice,
          evidence: [{ path: "src/a.ts" }],
          details: "Details",
          questionComment: "Comment",
        },
        { ...choice, questionId: "multi", values: ["b", "a"] },
      ],
      new Set(["src/a.ts"]),
    );
    expect(report.missingQuestionIds).toEqual([]);
    expect(report.recommendations.map((r) => r.questionId)).toEqual(["single", "multi", "text"]);
    expect(report.recommendations[0].evidence).toEqual([{ path: "src/a.ts" }]);
  });

  it("permits an own alternative for any question", () => {
    expect(
      parse([
        { questionId: "single", kind: "alternative", text: "Do neither", rationale: "Enough" },
      ]).recommendations[0],
    ).toMatchObject({ kind: "alternative", text: "Do neither" });
  });

  it.each([
    { values: [] },
    { values: ["a", "b"] },
    { values: ["bad"] },
    { values: ["a", "a"] },
    { values: [1] },
    { rationale: " " },
    { questionComment: 5 },
    { evidence: [{ path: "invented" }] },
    { evidence: [null] },
    { kind: "text", text: "Not a choice" },
    { questionId: "unknown" },
  ])("salvages valid siblings when a choice is invalid: %j", (patch) => {
    const report = parse([{ ...choice, ...patch }, answer]);
    expect(report.recommendations).toEqual([answer]);
    expect(report.missingQuestionIds).toEqual(["single", "multi"]);
  });

  it("rejects all duplicates for an ID rather than choosing first or last", () => {
    expect(parse([choice, { ...choice, values: ["b"] }, answer]).recommendations).toEqual([answer]);
    expect(parse([choice, { questionId: "single" }, answer]).recommendations).toEqual([answer]);
  });

  it("rejects empty text, duplicate multi values, malformed JSON, and no valid records", () => {
    for (const records of [
      [],
      [null],
      [{ ...answer, text: " " }],
      [{ ...choice, questionId: "multi", values: ["a", "a"] }],
    ]) {
      expect(() => parse(records)).toThrow("no valid recommendations");
    }
    expect(() => validateAdvisorReport("```json\n{}\n```", form, ADVISOR_DEFAULTS)).toThrow(
      "invalid JSON",
    );
    expect(() => validateAdvisorReport("[]", form, ADVISOR_DEFAULTS)).toThrow("invalid report");
  });
});
