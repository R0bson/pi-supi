import { expect, it } from "vitest";
import { resolveSessionCapabilityProfiles } from "../../src/session.ts";

it.each([
  { globalDefault: {}, projectDefault: {}, status: "none", source: undefined, id: undefined },
  {
    globalDefault: { defaultProfile: null },
    projectDefault: {},
    status: "none",
    source: "global",
    id: undefined,
  },
  {
    globalDefault: { defaultProfile: "research" },
    projectDefault: {},
    status: "resolved",
    source: "global",
    id: "research",
  },
  {
    globalDefault: { defaultProfile: "research" },
    projectDefault: { defaultProfile: null },
    status: "none",
    source: "project",
    id: undefined,
  },
  {
    globalDefault: { defaultProfile: null },
    projectDefault: { defaultProfile: "research" },
    status: "resolved",
    source: "project",
    id: "research",
  },
  {
    globalDefault: { defaultProfile: "writing" },
    projectDefault: { defaultProfile: "research" },
    status: "resolved",
    source: "project",
    id: "research",
  },
])("resolves default scope: %j", ({ globalDefault, projectDefault, status, source, id }) => {
  const result = resolveSessionCapabilityProfiles({
    global: {
      profiles: { research: { excludedTools: ["agent_run"] }, writing: {} },
      ...globalDefault,
    },
    project: { profiles: { research: { hiddenSkills: ["implement"] } }, ...projectDefault },
    projectTrusted: true,
  });
  expect(result.default.status).toBe(status);
  expect(result.default.source).toBe(source);
  if (result.default.status === "resolved") {
    expect(result.default.id).toBe(id);
    expect(result.default.profile).toEqual({
      id: "research",
      source: "project",
      excludedTools: [],
      hiddenSkills: ["implement"],
    });
  } else {
    expect(result.default).not.toHaveProperty("profile");
  }
  expect(result.errors).toEqual([]);
});

it("ignores all untrusted project definitions, errors, and default selections", () => {
  const result = resolveSessionCapabilityProfiles({
    global: { profiles: { research: {} }, defaultProfile: "research" },
    project: { profiles: { research: null, extra: {} }, defaultProfile: false, unknown: true },
    projectTrusted: false,
  });
  expect(result.entries).toEqual([
    {
      id: "research",
      source: "global",
      shadowed: false,
      errors: [],
      profile: { excludedTools: [], hiddenSkills: [] },
    },
  ]);
  expect(result.default).toEqual({
    status: "resolved",
    source: "global",
    id: "research",
    profile: { id: "research", source: "global", excludedTools: [], hiddenSkills: [] },
  });
  expect(result.errors).toEqual([]);
});

it.each([
  { defaultProfile: "missing" },
  { defaultProfile: "broken" },
  { defaultProfile: false },
  { defaultProfile: "Bad-ID" },
  { defaultProfile: undefined },
  { defaultProfile: [] },
])("reports an unavailable default without a fallback or an active profile: %j", (project) => {
  const result = resolveSessionCapabilityProfiles({
    global: { profiles: { research: {}, broken: {} }, defaultProfile: "research" },
    project: { ...project, profiles: { broken: { excludedTools: false }, valid: {} } },
    projectTrusted: true,
  });
  expect(result.default).toMatchObject({ status: "invalid", source: "project" });
  expect(result.default).not.toHaveProperty("profile");
  expect(result.effectiveProfiles.map(({ id }) => id)).toEqual(["research", "valid"]);
  expect(result.errors).toEqual(
    expect.arrayContaining([
      { scope: "project", path: "defaultProfile", message: expect.any(String) },
    ]),
  );
});

it("reports a bad global default even when a valid project default replaces it", () => {
  const result = resolveSessionCapabilityProfiles({
    global: { defaultProfile: false },
    project: { profiles: { research: {} }, defaultProfile: "research" },
    projectTrusted: true,
  });
  expect(result.default).toMatchObject({ status: "resolved", source: "project", id: "research" });
  expect(result.errors).toEqual([
    { scope: "global", path: "defaultProfile", message: expect.any(String) },
  ]);
});

it("uses no default when both raw sections are absent", () => {
  expect(resolveSessionCapabilityProfiles({ projectTrusted: false })).toEqual({
    entries: [],
    effectiveProfiles: [],
    default: { status: "none" },
    errors: [],
  });
});
