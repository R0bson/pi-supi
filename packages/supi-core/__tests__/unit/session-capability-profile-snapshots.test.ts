import { afterEach, expect, it } from "vitest";
import {
  clearPendingSessionCapabilityForks,
  createEmptySessionCapabilityState,
  decodeSessionCapabilities,
  findSessionCapabilities,
  isSessionCapabilityProfileModified,
  readPendingSessionCapabilityFork,
  SESSION_CAPABILITIES_ENTRY,
  sessionCapabilityState,
  setPendingSessionCapabilityFork,
} from "../../src/session.ts";

afterEach(() => {
  sessionCapabilityState.clear("profile-session");
  clearPendingSessionCapabilityForks();
});

it("copies the profile snapshot and retains unmatched exclusions without granting eligibility", () => {
  const stored = {
    version: 1,
    eligibleToolNames: ["code_find", "agent_run", "inactive"],
    initiallyInactiveToolNames: ["inactive"],
    toolDenylist: ["agent_run", "future_tool", "inactive", "future_tool", "read"],
    toolEnabledNames: ["code_find", "agent_run", "future_tool", "inactive", "read"],
    hiddenSkillNames: ["missing-skill"],
    profileSnapshot: {
      id: "research",
      source: "project",
      excludedTools: ["agent_run", "future_tool", "inactive", "read"],
      hiddenSkills: ["missing-skill"],
    },
  };
  const decoded = decodeSessionCapabilities(stored);
  expect(decoded).toEqual({
    version: 1,
    eligibleToolNames: ["code_find", "agent_run"],
    initiallyInactiveToolNames: ["inactive"],
    toolDenylist: ["agent_run", "future_tool", "inactive", "read"],
    toolEnabledNames: ["code_find"],
    hiddenSkillNames: ["missing-skill"],
    profileSnapshot: {
      id: "research",
      source: "project",
      excludedTools: ["agent_run", "future_tool", "inactive", "read"],
      hiddenSkills: ["missing-skill"],
    },
  });
  stored.profileSnapshot.excludedTools.length = 0;
  stored.profileSnapshot.hiddenSkills.push("changed");
  stored.toolDenylist.length = 0;
  expect(decoded?.profileSnapshot?.excludedTools).toEqual([
    "agent_run",
    "future_tool",
    "inactive",
    "read",
  ]);
  expect(decoded?.profileSnapshot?.hiddenSkills).toEqual(["missing-skill"]);
  expect(decoded?.toolDenylist).toEqual(["agent_run", "future_tool", "inactive", "read"]);
});

it.each(
  [
    undefined,
    null,
    [],
    "research",
    { id: "Bad-ID", source: "global", excludedTools: [], hiddenSkills: [] },
    { id: "research", source: "unknown", excludedTools: [], hiddenSkills: [] },
    { id: "research", source: "global", hiddenSkills: [] },
    { id: "research", source: "global", excludedTools: [], hiddenSkills: [1] },
    { id: "research", source: "global", excludedTools: [], hiddenSkills: [], extra: true },
  ].map((profileSnapshot) => ({ profileSnapshot })),
)("retains old state without a false profile identity: %j", ({ profileSnapshot }) => {
  const decoded = decodeSessionCapabilities({
    version: 1,
    toolDenylist: ["missing_tool"],
    hiddenSkillNames: ["missing-skill"],
    profileSnapshot,
  });
  expect(decoded).toMatchObject({
    version: 1,
    toolDenylist: ["missing_tool"],
    hiddenSkillNames: ["missing-skill"],
  });
  expect(decoded).not.toHaveProperty("profileSnapshot");
});

it("preserves independent snapshot copies through hidden entries, registry access, and forks", () => {
  const saved = {
    ...createEmptySessionCapabilityState(),
    toolDenylist: ["late_tool"],
    hiddenSkillNames: ["missing-skill"],
    profileSnapshot: {
      id: "research",
      source: "project" as const,
      excludedTools: ["late_tool", "agent_run"],
      hiddenSkills: ["missing-skill"],
    },
  };
  const restored = findSessionCapabilities([
    {
      type: "custom",
      customType: SESSION_CAPABILITIES_ENTRY,
      data: createEmptySessionCapabilityState(),
    },
    { type: "custom", customType: SESSION_CAPABILITIES_ENTRY, data: saved },
    { type: "custom", customType: SESSION_CAPABILITIES_ENTRY, data: { version: 2 } },
  ]);
  expect(restored).toEqual(saved);
  if (!restored) throw new Error("Expected restored state.");
  expect(isSessionCapabilityProfileModified(restored)).toBe(true);
  sessionCapabilityState.set("profile-session", restored);
  setPendingSessionCapabilityFork("source.jsonl", restored);
  restored.profileSnapshot?.excludedTools.push("changed");
  restored.hiddenSkillNames.length = 0;
  expect(sessionCapabilityState.get("profile-session")).toEqual(saved);
  sessionCapabilityState.get("profile-session")?.profileSnapshot?.hiddenSkills.push("changed");
  expect(sessionCapabilityState.get("profile-session")).toEqual(saved);
  expect(readPendingSessionCapabilityFork("source.jsonl")).toEqual(saved);
  expect(readPendingSessionCapabilityFork("source.jsonl")).toBeUndefined();
  expect(saved.profileSnapshot.excludedTools).toEqual(["late_tool", "agent_run"]);
});

it("retains an exclusion when its exact tool name later becomes eligible", () => {
  const saved = decodeSessionCapabilities({
    version: 1,
    toolDenylist: ["future_tool", "code_*"],
    hiddenSkillNames: ["missing-skill"],
  });
  const updated = decodeSessionCapabilities({
    ...saved,
    eligibleToolNames: ["future_tool", "code_find", "new_tool"],
    toolEnabledNames: ["future_tool", "code_find", "new_tool"],
  });
  expect(updated?.toolDenylist).toEqual(["future_tool", "code_*"]);
  expect(updated?.toolEnabledNames).toEqual(["code_find", "new_tool"]);
  expect(updated?.hiddenSkillNames).toEqual(["missing-skill"]);
});
