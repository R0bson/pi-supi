import { expect, it } from "vitest";
import {
  resolveSessionCapabilityProfiles,
  validateSessionCapabilityProfile,
} from "../../src/session.ts";

it("accepts empty profiles and copies exact exclusion sets without an inventory", () => {
  expect(validateSessionCapabilityProfile({})).toEqual({
    profile: { excludedTools: [], hiddenSkills: [] },
    errors: [],
  });
  const definition = {
    excludedTools: ["agent_run", "future_tool", "agent_run", "Agent_Run", "code_*"],
    hiddenSkills: ["implement", "missing-skill", "implement"],
  };
  const result = validateSessionCapabilityProfile(definition);
  definition.excludedTools.push("changed");
  definition.hiddenSkills.length = 0;
  expect(result).toEqual({
    profile: {
      excludedTools: ["agent_run", "future_tool", "Agent_Run", "code_*"],
      hiddenSkills: ["implement", "missing-skill"],
    },
    errors: [],
  });
});

it.each(
  [
    null,
    [],
    "research",
    1,
    { excludedTools: null },
    { excludedTools: "agent_run" },
    { excludedTools: ["agent_run", 1] },
    { excludedTools: Array(1) },
    { hiddenSkills: [undefined] },
    { excludedTools: undefined },
    { hiddenSkills: [false] },
    { hiddenSkills: {} },
    { hiddenSkills: undefined },
    { excludedTools: ["agent_run"], toolEnabledNames: [] },
    { hiddenSkills: ["implement"], profileSnapshot: {} },
  ].map((definition) => ({ definition })),
)("rejects the whole invalid definition: %j", ({ definition }) => {
  const result = validateSessionCapabilityProfile(definition);
  expect(result.profile).toBeUndefined();
  expect(result.errors.length).toBeGreaterThan(0);
});

it("replaces complete profiles by ID and keeps both scopes available for the UI", () => {
  const global = {
    profiles: {
      research: { excludedTools: ["agent_run"], hiddenSkills: ["implement"] },
      writing: {},
    },
  };
  const project = {
    profiles: { research: { hiddenSkills: ["review"] }, "code-review": {} },
  };
  const result = resolveSessionCapabilityProfiles({ global, project, projectTrusted: true });
  expect(result.effectiveProfiles).toEqual([
    { id: "research", source: "project", excludedTools: [], hiddenSkills: ["review"] },
    { id: "writing", source: "global", excludedTools: [], hiddenSkills: [] },
    { id: "code-review", source: "project", excludedTools: [], hiddenSkills: [] },
  ]);
  expect(result.entries).toEqual([
    {
      id: "research",
      source: "global",
      shadowed: true,
      errors: [],
      profile: { excludedTools: ["agent_run"], hiddenSkills: ["implement"] },
    },
    {
      id: "writing",
      source: "global",
      shadowed: false,
      errors: [],
      profile: { excludedTools: [], hiddenSkills: [] },
    },
    {
      id: "research",
      source: "project",
      shadowed: false,
      errors: [],
      profile: { excludedTools: [], hiddenSkills: ["review"] },
    },
    {
      id: "code-review",
      source: "project",
      shadowed: false,
      errors: [],
      profile: { excludedTools: [], hiddenSkills: [] },
    },
  ]);
  expect(result.errors).toEqual([]);
  expect(
    resolveSessionCapabilityProfiles({ global, project: {}, projectTrusted: true })
      .effectiveProfiles[0],
  ).toEqual({
    id: "research",
    source: "global",
    excludedTools: ["agent_run"],
    hiddenSkills: ["implement"],
  });
});

it("keeps independent errors and blocks global fallback for invalid project profiles", () => {
  const result = resolveSessionCapabilityProfiles({
    global: { profiles: { research: {}, writing: {} } },
    project: {
      profiles: {
        research: { excludedTools: ["agent_run", 1] },
        broken: { hiddenSkills: "review" },
        Research: {},
        "bad--id": {},
        "-bad": {},
        "bad-": {},
        bad_id: {},
        "": {},
        review2: {},
        "code-review": {},
      },
    },
    projectTrusted: true,
  });
  expect(result.effectiveProfiles.map(({ id }) => id)).toEqual(["writing", "code-review"]);
  expect(
    result.entries.find((entry) => entry.id === "research" && entry.source === "global"),
  ).toMatchObject({ shadowed: true, errors: [] });
  const invalid = result.entries.filter((entry) => entry.errors.length);
  expect(invalid.map(({ id }) => id)).toEqual([
    "research",
    "broken",
    "Research",
    "bad--id",
    "-bad",
    "bad-",
    "bad_id",
    "",
    "review2",
  ]);
  expect(invalid.every((entry) => entry.profile === undefined)).toBe(true);
  expect(result.errors).toHaveLength(9);
  expect(result.errors[0]).toEqual({
    scope: "project",
    path: "profiles.research",
    message: expect.any(String),
  });
});

it.each(
  [
    null,
    [],
    true,
    "invalid",
    new Date(0),
    { profiles: [] },
    { profiles: null },
    { profiles: undefined },
    { profiles: { research: {} }, unknown: true },
  ].map((project) => ({ project })),
)("reports an invalid section without applying a partial section: %j", ({ project }) => {
  const result = resolveSessionCapabilityProfiles({
    global: { profiles: { writing: {} } },
    project,
    projectTrusted: true,
  });
  expect(result.errors.length).toBeGreaterThan(0);
  expect(result.errors.every((error) => error.scope === "project")).toBe(true);
  expect(result.effectiveProfiles.map(({ id }) => id)).toEqual(["writing"]);
  expect(result.default).toEqual({ status: "invalid", source: "project" });
});

it("keeps invalid-section project IDs from exposing the same global profiles", () => {
  const result = resolveSessionCapabilityProfiles({
    global: { profiles: { research: {}, writing: {} }, defaultProfile: "research" },
    project: { profiles: { research: {} }, typo: true },
    projectTrusted: true,
  });
  expect(result.effectiveProfiles.map(({ id }) => id)).toEqual(["writing"]);
  expect(result.entries.find((entry) => entry.source === "project")).toMatchObject({
    id: "research",
    profile: undefined,
    errors: [expect.objectContaining({ scope: "project" })],
  });
});
