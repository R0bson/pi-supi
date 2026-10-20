import { describe, expect, it } from "vitest";
import { type DiagnosticFixMessage, waitForDiagnosticFix } from "./diagnostic-fix-observation.ts";

const file = "/workspace/example.py";
const knownError: DiagnosticFixMessage = {
  line: 8,
  severity: "error",
  message: "Unsupported operand types",
  source: "basedpyright",
};
const controlError: DiagnosticFixMessage = {
  line: 12,
  severity: "error",
  message: "Independent control error",
  source: "basedpyright",
};

function makeData(
  kind: "completed" | "partial" | "unavailable",
  entries: readonly {
    readonly file: string;
    readonly errors: number;
    readonly messages?: readonly DiagnosticFixMessage[];
  }[],
) {
  return {
    diagnosticObservation: {
      kind,
      entries,
      evidence: {
        requested: 1,
        confirmed: kind === "completed" ? 1 : 0,
        unconfirmed: kind === "partial" ? 1 : 0,
        failed: kind === "unavailable" ? 1 : 0,
      },
    },
  };
}

describe("bounded diagnostic-fix observation", () => {
  it("fails when a partial observation retains the known error and control", async () => {
    let time = 0;
    let requests = 0;
    const stale = makeData("partial", [
      {
        file,
        errors: 2,
        messages: [{ ...knownError, source: "pyright" }, controlError],
      },
    ]);

    await expect(
      waitForDiagnosticFix({
        observe: async () => {
          requests += 1;
          return stale;
        },
        file,
        previous: [knownError],
        control: [controlError],
        timeoutMs: 10,
        pollIntervalMs: 5,
        now: () => time,
        sleep: async (milliseconds) => {
          time += milliseconds;
        },
      }),
    ).rejects.toThrow("did not change within 10 ms");
    expect(requests).toBe(2);
  });

  it("fails when every observation is unavailable", async () => {
    let time = 0;
    let requests = 0;

    await expect(
      waitForDiagnosticFix({
        observe: async () => {
          requests += 1;
          return makeData("unavailable", []);
        },
        file,
        previous: [knownError],
        control: [controlError],
        timeoutMs: 10,
        pollIntervalMs: 5,
        now: () => time,
        sleep: async (milliseconds) => {
          time += milliseconds;
        },
      }),
    ).rejects.toThrow("did not change within 10 ms");
    expect(requests).toBe(2);
  });

  it("accepts changed partial data only when it retains the independent control", async () => {
    const observations = [
      makeData("unavailable", []),
      makeData("partial", [{ file, errors: 1, messages: [controlError] }]),
    ];
    let time = 0;
    const result = await waitForDiagnosticFix({
      observe: async () => {
        const observation = observations.shift();
        if (!observation) throw new Error("No test observation remains.");
        return observation;
      },
      file,
      previous: [knownError],
      control: [controlError],
      timeoutMs: 10,
      pollIntervalMs: 5,
      now: () => time,
      sleep: async (milliseconds) => {
        time += milliseconds;
      },
    });

    expect(result.diagnosticObservation).toMatchObject({
      kind: "partial",
      entries: [{ file, errors: 1, messages: [controlError] }],
      evidence: { requested: 1, confirmed: 0, unconfirmed: 1 },
    });
  });

  it("fails when the control error is absent or its message list is incomplete", async () => {
    const observations = [
      makeData("partial", [{ file, errors: 0, messages: [] }]),
      makeData("partial", [{ file, errors: 1, messages: [] }]),
    ];
    let time = 0;

    await expect(
      waitForDiagnosticFix({
        observe: async () => {
          const observation = observations.shift();
          if (!observation) throw new Error("No test observation remains.");
          return observation;
        },
        file,
        previous: [knownError],
        control: [controlError],
        timeoutMs: 10,
        pollIntervalMs: 5,
        now: () => time,
        sleep: async (milliseconds) => {
          time += milliseconds;
        },
      }),
    ).rejects.toThrow("did not change within 10 ms");
  });

  it("accepts a changed error in a partial observation when the control remains", async () => {
    const changedError: DiagnosticFixMessage = {
      ...knownError,
      message: "A different diagnostic remains",
    };
    const changed = makeData("partial", [
      { file, errors: 2, messages: [changedError, controlError] },
    ]);
    const result = await waitForDiagnosticFix({
      observe: async () => changed,
      file,
      previous: [knownError],
      control: [controlError],
      timeoutMs: 5,
      pollIntervalMs: 5,
    });

    expect(result.diagnosticObservation.kind).toBe("partial");
  });
});
