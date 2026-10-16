import { expect, it } from "vitest";
import {
  applySessionCapabilityProfile,
  captureSessionCapabilityExclusions,
  createEmptySessionCapabilityState,
  isSessionCapabilityProfileModified,
  resolveSessionCapabilityProfiles,
} from "../../src/session.ts";

it("replaces both exclusion lists with a session copy and leaves configuration independent", () => {
  const definition = { excludedTools: ["future_tool"], hiddenSkills: ["missing-skill"] };
  const result = resolveSessionCapabilityProfiles({
    project: { profiles: { research: definition } },
    projectTrusted: true,
  });
  const original = {
    ...createEmptySessionCapabilityState(),
    eligibleToolNames: ["agent_run", "code_find", "inactive"],
    initiallyInactiveToolNames: ["inactive"],
    toolDenylist: ["agent_run"],
    toolEnabledNames: ["code_find", "inactive", "future_tool"],
    hiddenSkillNames: ["implement"],
  };
  const applied = applySessionCapabilityProfile(original, result.effectiveProfiles[0]);
  expect(applied).toEqual({
    version: 1,
    eligibleToolNames: ["agent_run", "code_find"],
    initiallyInactiveToolNames: ["inactive"],
    toolDenylist: ["future_tool"],
    toolEnabledNames: ["code_find"],
    hiddenSkillNames: ["missing-skill"],
    profileSnapshot: {
      id: "research",
      source: "project",
      excludedTools: ["future_tool"],
      hiddenSkills: ["missing-skill"],
    },
  });
  expect(original.toolDenylist).toEqual(["agent_run"]);
  expect(original.hiddenSkillNames).toEqual(["implement"]);
  if (!applied) throw new Error("Expected an applied profile.");
  definition.excludedTools.push("later-change");
  result.effectiveProfiles[0]?.hiddenSkills.push("later-change");
  const captured = captureSessionCapabilityExclusions(applied);
  expect(captured).toEqual({ excludedTools: ["future_tool"], hiddenSkills: ["missing-skill"] });
  captured.excludedTools.length = 0;
  expect(applied.toolDenylist).toEqual(["future_tool"]);
  expect(applied.profileSnapshot?.hiddenSkills).toEqual(["missing-skill"]);
});

it("compares current sets with the applied copy, not order, duplicates, or saved definitions", () => {
  const profile = {
    id: "research",
    source: "global",
    excludedTools: ["agent_run", "future_tool"],
    hiddenSkills: ["implement", "missing-skill"],
  };
  const applied = applySessionCapabilityProfile(createEmptySessionCapabilityState(), profile);
  if (!applied) throw new Error("Expected an applied profile.");
  expect(isSessionCapabilityProfileModified(applied)).toBe(false);
  profile.excludedTools.length = 0;
  profile.hiddenSkills.push("changed");
  applied.toolDenylist = ["future_tool", "agent_run", "future_tool"];
  applied.hiddenSkillNames = ["missing-skill", "implement", "implement"];
  expect(isSessionCapabilityProfileModified(applied)).toBe(false);
  applied.toolDenylist = ["future_tool", "different_tool"];
  expect(isSessionCapabilityProfileModified(applied)).toBe(true);
  applied.toolDenylist = ["agent_run", "future_tool"];
  applied.hiddenSkillNames = [];
  expect(isSessionCapabilityProfileModified(applied)).toBe(true);
  applied.hiddenSkillNames = ["implement", "missing-skill"];
  expect(isSessionCapabilityProfileModified(applied)).toBe(false);
  expect(isSessionCapabilityProfileModified({ ...applied, profileSnapshot: undefined })).toBe(
    false,
  );
});

it("leaves the session unchanged when a selected profile is invalid", () => {
  const original = {
    ...createEmptySessionCapabilityState(),
    toolDenylist: ["agent_run"],
    hiddenSkillNames: ["implement"],
    profileSnapshot: {
      id: "writing",
      source: "global" as const,
      excludedTools: [],
      hiddenSkills: [],
    },
  };
  const before = structuredClone(original);
  const result = applySessionCapabilityProfile(original, {
    id: "research",
    source: "project",
    excludedTools: ["future_tool"],
    hiddenSkills: false,
  });
  expect(result).toBeUndefined();
  expect(original).toEqual(before);
});

it("replaces the applied identity on reapplication and clears it in an empty state", () => {
  const first = applySessionCapabilityProfile(createEmptySessionCapabilityState(), {
    id: "research",
    source: "project",
    excludedTools: ["future_tool"],
    hiddenSkills: ["missing-skill"],
  });
  if (!first) throw new Error("Expected an applied profile.");
  const second = applySessionCapabilityProfile(first, {
    id: "writing",
    source: "global",
    excludedTools: [],
    hiddenSkills: [],
  });
  expect(second).toMatchObject({
    toolDenylist: [],
    hiddenSkillNames: [],
    profileSnapshot: { id: "writing", source: "global", excludedTools: [], hiddenSkills: [] },
  });
  expect(first.toolDenylist).toEqual(["future_tool"]);
  expect(first.hiddenSkillNames).toEqual(["missing-skill"]);
  expect(createEmptySessionCapabilityState()).not.toHaveProperty("profileSnapshot");
});
