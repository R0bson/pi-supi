import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadSupiConfig, loadSupiConfigSectionForScope } from "@mrclrchtr/supi-core/config";
import {
  type CustomField,
  defineConfigSettings,
  registerSettings,
} from "@mrclrchtr/supi-core/settings";
import type { AdvisorProfile } from "./types.ts";

/** Flat fields in the `ask-user-advisor` SuPi config section. No timeout or fallback. */
export interface AdvisorConfig extends AdvisorProfile {
  /** Maximum assistant turns allowed to execute tools; zero disables tools. */
  maxToolTurns: number;
  /** Maximum calls executed across the entire run; zero disables tools. */
  maxToolCalls: number;
}

/** Independent default profile and finite tool budgets. */
export const ADVISOR_DEFAULTS: Readonly<AdvisorConfig> = {
  provider: "openai",
  model: "gpt-6.1-sol",
  reasoning: "medium",
  maxToolTurns: 6,
  maxToolCalls: 20,
};

const REASONING = ["minimal", "low", "medium", "high", "xhigh"] as const;

/** Resolve defaults ← global ← cwd project config. Invalid settings fail closed. */
export function loadAdvisorConfig(cwd: string, homeDir?: string): AdvisorConfig {
  const raw = loadSupiConfig("ask-user-advisor", cwd, { ...ADVISOR_DEFAULTS }, { homeDir });
  if (
    typeof raw.provider !== "string" ||
    !/^[a-zA-Z0-9._-]+$/.test(raw.provider) ||
    typeof raw.model !== "string" ||
    !raw.model.trim() ||
    raw.model.length > 200 ||
    !REASONING.includes(raw.reasoning) ||
    !validBudget(raw.maxToolTurns, 30) ||
    !validBudget(raw.maxToolCalls, 100)
  ) {
    throw new Error("Ask User advisor configuration is invalid.");
  }
  return {
    provider: raw.provider,
    model: raw.model,
    reasoning: raw.reasoning,
    maxToolTurns: raw.maxToolTurns,
    maxToolCalls: raw.maxToolCalls,
  };
}

function validBudget(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

/** The generic numeric settings field accepts only positive integers; budgets also support zero. */
function budgetField(
  key: "maxToolTurns" | "maxToolCalls",
  label: string,
  max: number,
  homeDir?: string,
): CustomField {
  return {
    kind: "custom",
    key,
    label,
    description: `Integer from 0 to ${max}; zero disables tools.`,
    resolve(scope, cwd) {
      const global = loadSupiConfigSectionForScope("ask-user-advisor", cwd, {
        scope: "global",
        homeDir,
      });
      const project = loadSupiConfigSectionForScope("ask-user-advisor", cwd, {
        scope: "project",
        homeDir,
      });
      const inheritanceSource = global && Object.hasOwn(global, key) ? "global" : "default";
      const source =
        scope === "project" && project && Object.hasOwn(project, key)
          ? "project"
          : inheritanceSource;
      const raw = source === "project" ? project?.[key] : global?.[key];
      const value = String(raw ?? ADVISOR_DEFAULTS[key]);
      return { displayValue: `${value} (${source})`, editValue: value, source, inheritanceSource };
    },
    persist(_scope, _cwd, action, helpers) {
      if (action.kind === "unset") {
        helpers.unset(key);
        return;
      }
      const value = Number(action.value);
      if (!/^\d+$/.test(action.value.trim()) || !validBudget(value, max))
        throw new Error("Invalid advisor tool budget.");
      helpers.set(key, value);
    },
  };
}

/** Register settings during extension factory execution; does not initiate model work. */
export function registerAdvisorSettings(pi: ExtensionAPI, homeDir?: string): void {
  registerSettings(
    pi,
    defineConfigSettings({
      id: "ask-user-advisor",
      label: "Ask User Advisor",
      section: "ask-user-advisor",
      defaults: { ...ADVISOR_DEFAULTS },
      fields: [
        {
          kind: "string",
          key: "provider",
          label: "Provider",
          description: "Fixed provider; no fallback",
        },
        {
          kind: "string",
          key: "model",
          label: "Model",
          description: "Fixed model ID; independent of agent",
        },
        { kind: "enum", key: "reasoning", label: "Reasoning", values: [...REASONING] },
        budgetField("maxToolTurns", "Tool turns (0–30)", 30, homeDir),
        budgetField("maxToolCalls", "Tool calls (0–100)", 100, homeDir),
      ],
      ...(homeDir ? { homeDir } : {}),
    }),
  );
}
