import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getSupiConfigPath } from "@mrclrchtr/supi-core/config";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createCapabilityProfileStore } from "../../src/session-capability-profile-store.ts";

let root: string;
let cwd: string;
let homeDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "supi-profile-store-"));
  cwd = join(root, "project");
  homeDir = join(root, "home");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeConfig(scope: "global" | "project", value: unknown): void {
  const path = getSupiConfigPath(scope, cwd, { homeDir });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

it("reads scoped profiles with whole-profile replacement and an inherited default", () => {
  writeConfig("global", {
    sessionCapabilities: {
      profiles: { research: { excludedTools: ["agent_run"] }, writing: {} },
      defaultProfile: "research",
    },
  });
  writeConfig("project", {
    sessionCapabilities: {
      profiles: { research: { hiddenSkills: ["implement"] }, "code-review": {} },
    },
  });
  const catalog = createCapabilityProfileStore({
    cwd,
    homeDir,
    isProjectTrusted: () => true,
  }).read();

  expect(catalog.effectiveProfiles).toEqual([
    { id: "research", source: "project", excludedTools: [], hiddenSkills: ["implement"] },
    { id: "writing", source: "global", excludedTools: [], hiddenSkills: [] },
    { id: "code-review", source: "project", excludedTools: [], hiddenSkills: [] },
  ]);
  expect(catalog.entries[0]).toMatchObject({ id: "research", source: "global", shadowed: true });
  expect(catalog.default).toMatchObject({
    status: "resolved",
    source: "global",
    id: "research",
    profile: { source: "project" },
  });
  expect(catalog.defaultValues).toEqual({ global: "research" });
  expect(catalog.errors).toEqual([]);
});

it("uses an empty catalog for absent config files and ignores untrusted project data", () => {
  const store = createCapabilityProfileStore({ cwd, homeDir, isProjectTrusted: () => false });
  const empty = {
    entries: [],
    effectiveProfiles: [],
    default: { status: "none" },
    errors: [],
    defaultValues: {},
  };
  expect(store.read()).toEqual(empty);
  writeConfig("project", {
    sessionCapabilities: { profiles: { research: {} }, defaultProfile: 1 },
  });
  expect(store.read()).toEqual(empty);
});

it.each(["{", "[]", "null", '"invalid"'])(
  "reports malformed config without using the global default: %s",
  (content) => {
    writeConfig("global", {
      sessionCapabilities: { profiles: { research: {} }, defaultProfile: "research" },
    });
    const path = getSupiConfigPath("project", cwd, { homeDir });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    let trusted = true;
    const store = createCapabilityProfileStore({ cwd, homeDir, isProjectTrusted: () => trusted });

    const catalog = store.read();
    expect(catalog.default).toEqual({ status: "invalid", source: "project" });
    expect(catalog.errors).toEqual([{ scope: "project", path, message: expect.any(String) }]);
    trusted = false;
    expect(store.read().default).toMatchObject({ status: "resolved", id: "research" });
    expect(store.read().errors).toEqual([]);
  },
);

it("reports invalid project overrides while keeping other profiles and raw defaults", () => {
  writeConfig("global", {
    sessionCapabilities: { profiles: { research: {}, writing: {} }, defaultProfile: "research" },
  });
  writeConfig("project", {
    sessionCapabilities: {
      profiles: { research: { excludedTools: false }, "code-review": {} },
      defaultProfile: ["research"],
    },
  });
  const catalog = createCapabilityProfileStore({
    cwd,
    homeDir,
    isProjectTrusted: () => true,
  }).read();
  expect(catalog.effectiveProfiles.map(({ id }) => id)).toEqual(["writing", "code-review"]);
  expect(catalog.entries[0]).toMatchObject({ id: "research", source: "global", shadowed: true });
  expect(catalog.errors).toEqual([
    { scope: "project", path: "profiles.research", message: expect.any(String) },
    { scope: "project", path: "defaultProfile", message: expect.any(String) },
  ]);
  expect(catalog.default).toEqual({ status: "invalid", source: "project" });
  expect(catalog.defaultValues).toEqual({ global: "research", project: ["research"] });
});

it.each([
  null,
  [],
  false,
  { profiles: null },
  { profiles: [] },
  { profiles: { research: {} }, unknown: true },
])("does not inherit the global default after a malformed project section: %j", (section) => {
  writeConfig("global", {
    sessionCapabilities: { profiles: { research: {} }, defaultProfile: "research" },
  });
  writeConfig("project", { sessionCapabilities: section });
  const catalog = createCapabilityProfileStore({
    cwd,
    homeDir,
    isProjectTrusted: () => true,
  }).read();
  expect(catalog.default).toEqual({ status: "invalid", source: "project" });
  expect(catalog.errors).toContainEqual({
    scope: "project",
    path: expect.any(String),
    message: expect.any(String),
  });
});

it("reports file read errors while keeping valid project profiles available", () => {
  const path = getSupiConfigPath("global", cwd, { homeDir });
  mkdirSync(path, { recursive: true });
  writeConfig("project", {
    sessionCapabilities: { profiles: { research: {} }, defaultProfile: "research" },
  });
  const catalog = createCapabilityProfileStore({
    cwd,
    homeDir,
    isProjectTrusted: () => true,
  }).read();
  expect(catalog.errors).toEqual([{ scope: "global", path, message: expect.any(String) }]);
  expect(catalog.default).toMatchObject({ status: "resolved", source: "project", id: "research" });
});
