import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSettingsContributionCollector,
  SUPI_SETTINGS_COLLECT_EVENT,
} from "@mrclrchtr/supi-core/settings";
import { createPiMock } from "@mrclrchtr/supi-test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ADVISOR_DEFAULTS,
  loadAdvisorConfig,
  registerAdvisorSettings,
} from "../../src/advisor/settings.ts";

let root: string;
let cwd: string;
let home: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "advisor-config-"));
  cwd = join(root, "project");
  home = join(root, "home");
  await mkdir(cwd);
  await mkdir(home);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function config(scope: "project" | "global", values: unknown) {
  const directory = scope === "project" ? join(cwd, ".pi/supi") : join(home, ".pi/agent/supi");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "config.json"), JSON.stringify({ "ask-user-advisor": values }));
}

describe("advisor settings", () => {
  it("uses independent defaults and actual global/project SuPi config conventions", async () => {
    expect(loadAdvisorConfig(cwd, home)).toEqual(ADVISOR_DEFAULTS);
    await config("global", { provider: "other", model: "fixed", maxToolCalls: 12 });
    await config("project", { reasoning: "high", maxToolTurns: 2 });
    expect(loadAdvisorConfig(cwd, home)).toEqual({
      provider: "other",
      model: "fixed",
      reasoning: "high",
      maxToolCalls: 12,
      maxToolTurns: 2,
    });
  });

  it.each([
    { maxToolCalls: -1 },
    { maxToolTurns: 1.5 },
    { maxToolCalls: 101 },
    { maxToolTurns: 31 },
    { reasoning: "invented" },
    { model: "" },
    { provider: " " },
    { maxToolCalls: "20" },
  ])("fails closed for invalid config instead of changing routing/budgets: %j", async (value) => {
    await config("project", value);
    expect(() => loadAdvisorConfig(cwd, home)).toThrow("configuration is invalid");
  });

  it("registers a settings module with scoped read/apply/reset and no timeout", async () => {
    const pi = createPiMock();
    registerAdvisorSettings(pi as never, home);
    const collector = createSettingsContributionCollector();
    pi.events.emit(SUPI_SETTINGS_COLLECT_EVENT, collector);
    const module = collector.result().modules[0];
    expect(module).toMatchObject({ id: "ask-user-advisor", label: "Ask User Advisor" });
    const { rows } = await module.read({ cwd, scope: "project" });
    expect(rows.map((row) => row.field.key)).toEqual([
      "provider",
      "model",
      "reasoning",
      "maxToolTurns",
      "maxToolCalls",
    ]);
    expect(rows.every((row) => row.source === "default")).toBe(true);
    await module.apply({
      cwd,
      scope: "global",
      fieldKey: "maxToolTurns",
      action: { kind: "set", value: "3" },
    });
    expect(loadAdvisorConfig(cwd, home).maxToolTurns).toBe(3);
    await module.apply({
      cwd,
      scope: "project",
      fieldKey: "maxToolTurns",
      action: { kind: "set", value: "0" },
    });
    expect(loadAdvisorConfig(cwd, home).maxToolTurns).toBe(0);
    await module.apply({
      cwd,
      scope: "project",
      fieldKey: "maxToolTurns",
      action: { kind: "unset" },
    });
    expect(loadAdvisorConfig(cwd, home).maxToolTurns).toBe(3);
  });
});
