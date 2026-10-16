import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getSupiConfigPath } from "@mrclrchtr/supi-core/config";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createCapabilityProfileStore } from "../../src/session-capability-profile-store.ts";

let root: string;
let cwd: string;
let homeDir: string;
let trusted: boolean;
let store: ReturnType<typeof createCapabilityProfileStore>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "supi-profile-store-"));
  cwd = join(root, "project");
  homeDir = join(root, "home");
  trusted = true;
  store = createCapabilityProfileStore({ cwd, homeDir, isProjectTrusted: () => trusted });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeConfig(scope: "global" | "project", value: unknown): void {
  const path = getSupiConfigPath(scope, cwd, { homeDir });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

it("saves exact exclusion sets in an explicit scope without an inventory", () => {
  store.save("global", "research", {
    excludedTools: ["future_tool", "agent_run", "future_tool"],
    hiddenSkills: ["missing-skill", "missing-skill"],
  });
  store.save("project", "empty", {});

  expect(store.read().effectiveProfiles).toEqual([
    {
      id: "research",
      source: "global",
      excludedTools: ["future_tool", "agent_run"],
      hiddenSkills: ["missing-skill"],
    },
    { id: "empty", source: "project", excludedTools: [], hiddenSkills: [] },
  ]);
  expect(store.read().default).toEqual({ status: "none" });
});

it("requires replacement only for the selected scoped definition", () => {
  store.save("global", "research", { excludedTools: ["agent_run"] });
  store.save("project", "research", { hiddenSkills: ["implement"] });
  expect(() => store.save("project", "research", {})).toThrow(/already exists/i);
  expect(store.read().effectiveProfiles).toEqual([
    { id: "research", source: "project", excludedTools: [], hiddenSkills: ["implement"] },
  ]);

  store.save("project", "research", { excludedTools: ["future_tool"] }, true);
  expect(store.read().entries).toEqual([
    {
      id: "research",
      source: "global",
      shadowed: true,
      errors: [],
      profile: { excludedTools: ["agent_run"], hiddenSkills: [] },
    },
    {
      id: "research",
      source: "project",
      shadowed: false,
      errors: [],
      profile: { excludedTools: ["future_tool"], hiddenSkills: [] },
    },
  ]);
});

it.each(["Research", "bad--id", "bad_id", "", "__proto__", "review2"])(
  "rejects invalid profile ID %j without changing config",
  (id) => {
    store.save("global", "keep", {});
    const before = store.read();
    expect(() => store.save("global", id, {})).toThrow(/profile ID/i);
    expect(store.read()).toEqual(before);
  },
);

it("checks current trust before each project save and still permits global saves", () => {
  store.save("project", "research", {});
  trusted = false;
  expect(() => store.save("project", "research", { excludedTools: ["agent_run"] }, true)).toThrow(
    /trust/i,
  );
  store.save("global", "writing", {});
  expect(store.read().effectiveProfiles.map(({ id }) => id)).toEqual(["writing"]);
  trusted = true;
  expect(store.read().effectiveProfiles).toContainEqual({
    id: "research",
    source: "project",
    excludedTools: [],
    hiddenSkills: [],
  });
});

it("deletes only the scoped definition and leaves both default references unchanged", () => {
  writeConfig("global", {
    sessionCapabilities: {
      profiles: { research: { excludedTools: ["agent_run"] }, writing: {} },
      defaultProfile: "research",
    },
  });
  writeConfig("project", {
    other: { keep: true },
    sessionCapabilities: {
      profiles: { research: { hiddenSkills: ["implement"] }, "code-review": {} },
      defaultProfile: "research",
    },
  });
  store.delete("project", "research");
  expect(store.read().default).toMatchObject({
    status: "resolved",
    source: "project",
    id: "research",
    profile: { source: "global" },
  });
  expect(JSON.parse(readFileSync(getSupiConfigPath("project", cwd), "utf-8"))).toEqual({
    other: { keep: true },
    sessionCapabilities: { profiles: { "code-review": {} }, defaultProfile: "research" },
  });

  store.delete("global", "research");
  expect(store.read().default).toEqual({ status: "invalid", source: "project", id: "research" });
  expect(store.read().defaultValues).toEqual({ global: "research", project: "research" });
  expect(store.read().effectiveProfiles.map(({ id }) => id)).toEqual(["writing", "code-review"]);
});

it("supports named defaults, explicit none, project inheritance, and global reset", () => {
  store.save("global", "research", { excludedTools: ["agent_run"] });
  store.save("project", "research", { hiddenSkills: ["implement"] });
  store.setDefault("global", "research");
  expect(store.read().default).toMatchObject({
    status: "resolved",
    source: "global",
    id: "research",
    profile: { source: "project" },
  });

  store.setDefault("project", null);
  expect(store.read().default).toEqual({ status: "none", source: "project" });
  expect(store.read().defaultValues).toEqual({ global: "research", project: null });
  store.setDefault("project", undefined);
  expect(store.read().default).toMatchObject({ status: "resolved", source: "global" });
  expect(store.read().defaultValues).toEqual({ global: "research" });
  store.setDefault("global", undefined);
  expect(store.read().default).toEqual({ status: "none" });
  expect(store.read().defaultValues).toEqual({});
  expect(store.read().effectiveProfiles).toEqual([
    { id: "research", source: "project", excludedTools: [], hiddenSkills: ["implement"] },
  ]);
});

it.each(["missing", "research", "Bad-ID"])(
  "refuses default %j unless it resolves to a valid effective profile",
  (id) => {
    store.save("global", "research", {});
    writeConfig("project", {
      sessionCapabilities: {
        profiles: { research: { hiddenSkills: false } },
        defaultProfile: null,
      },
    });
    const before = store.read();
    expect(() => store.setDefault("global", id)).toThrow(/missing or invalid/i);
    expect(() => store.setDefault("project", id)).toThrow(/missing or invalid/i);
    expect(store.read()).toEqual(before);
  },
);

it.each(["global", "project"] as const)(
  "refuses all writes to malformed %s files and identifies the file",
  (scope) => {
    store.save(scope, "research", {});
    store.read();
    const path = getSupiConfigPath(scope, cwd, { homeDir });
    writeFileSync(path, '{"other":');

    expect(() => store.save(scope, "research", {}, true)).toThrow(path);
    expect(() => store.delete(scope, "research")).toThrow(path);
    expect(() => store.setDefault(scope, null)).toThrow(path);
    expect(readFileSync(path, "utf-8")).toBe('{"other":');
  },
);

it.each([null, { excludedTools: [1] }, { hiddenSkills: "implement" }, { unknown: true }])(
  "refuses invalid definitions without changing the saved profile: %j",
  (definition) => {
    store.save("project", "research", { excludedTools: ["future_tool"] });
    const before = store.read();
    expect(() => store.save("project", "research", definition, true)).toThrow();
    expect(store.read()).toEqual(before);
  },
);

it.each(["save", "replace", "delete", "setDefault"] as const)(
  "%s reads current config and preserves unrelated sections and profile entries",
  (action) => {
    store.save("project", "research", {});
    store.read();
    writeConfig("project", {
      other: { changed: true },
      sessionCapabilities: {
        profiles: {
          research: { hiddenSkills: ["implement"] },
          keep: { excludedTools: ["future_tool", "future_tool"] },
          broken: { unknown: true },
        },
        defaultProfile: "research",
      },
    });

    if (action === "save") store.save("project", "new-profile", {});
    if (action === "replace") store.save("project", "research", {}, true);
    if (action === "delete") store.delete("project", "research");
    if (action === "setDefault") store.setDefault("project", null);

    expect(JSON.parse(readFileSync(getSupiConfigPath("project", cwd), "utf-8"))).toMatchObject({
      other: { changed: true },
      sessionCapabilities: {
        profiles: {
          keep: { excludedTools: ["future_tool", "future_tool"] },
          broken: { unknown: true },
        },
        defaultProfile: action === "setDefault" ? null : "research",
      },
    });
  },
);

it.each(["delete", "setDefault"] as const)("checks current trust before %s", (action) => {
  store.save("project", "research", {});
  store.setDefault("project", "research");
  const before = store.read();
  trusted = false;
  expect(() => {
    if (action === "delete") store.delete("project", "research");
    else store.setDefault("project", null);
  }).toThrow(/trust/i);
  trusted = true;
  expect(store.read()).toEqual(before);
});

it.each([
  "null",
  "[]",
  '{"sessionCapabilities":null}',
  '{"sessionCapabilities":[]}',
  '{"sessionCapabilities":{"profiles":null}}',
  '{"sessionCapabilities":{"profiles":[]}}',
])("refuses to replace malformed config containers: %s", (content) => {
  const path = getSupiConfigPath("project", cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  expect(() => store.save("project", "research", {})).toThrow(path);
  expect(() => store.delete("project", "research")).toThrow(path);
  expect(() => store.setDefault("project", undefined)).toThrow(path);
  expect(readFileSync(path, "utf-8")).toBe(content);
});

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "reports failure when the last default cannot be removed",
  () => {
    store.setDefault("global", null);
    const path = getSupiConfigPath("global", cwd, { homeDir });
    chmodSync(dirname(path), 0o500);
    try {
      expect(() => store.setDefault("global", undefined)).toThrow();
      expect(store.read().defaultValues).toEqual({ global: null });
    } finally {
      chmodSync(dirname(path), 0o700);
    }
  },
);

it("requires explicit replacement for a newly stored invalid definition", () => {
  store.read();
  writeConfig("project", {
    sessionCapabilities: { profiles: { research: null, broken: { unknown: true } } },
  });
  expect(() => store.save("project", "research", {})).toThrow(/already exists/i);
  store.save("project", "research", {}, true);
  expect(store.read().effectiveProfiles).toEqual([
    { id: "research", source: "project", excludedTools: [], hiddenSkills: [] },
  ]);
  expect(store.read().errors).toEqual([
    { scope: "project", path: "profiles.broken", message: expect.any(String) },
  ]);
});

it("selects from the current effective profiles after trust changes", () => {
  store.save("project", "research", {});
  store.setDefault("global", "research");
  expect(store.read().default).toMatchObject({
    status: "resolved",
    source: "global",
    profile: { source: "project" },
  });
  trusted = false;
  expect(() => store.setDefault("global", "research")).toThrow(/missing or invalid/i);
  expect(store.read().default).toEqual({ status: "invalid", source: "global", id: "research" });
  store.setDefault("global", null);
  expect(store.read().default).toEqual({ status: "none", source: "global" });
});

it("deletes a hidden global definition without changing the project definition", () => {
  store.save("global", "research", {});
  store.save("project", "research", { hiddenSkills: ["implement"] });
  store.delete("global", "research");
  store.delete("global", "missing");
  expect(store.read().entries).toEqual([
    {
      id: "research",
      source: "project",
      shadowed: false,
      errors: [],
      profile: { excludedTools: [], hiddenSkills: ["implement"] },
    },
  ]);
});
