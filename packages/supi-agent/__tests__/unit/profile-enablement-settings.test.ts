import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createProfileSettingsSection,
  createProfileSettingsSections,
  discoverProfileCatalogue,
  resolveProfileDefinition,
} from "../../src/api.ts";
import { manifest, writeProfile } from "../helpers/profile-fixtures.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function profileSettings() {
  const root = await mkdtemp(join(tmpdir(), "supi-agent-enablement-"));
  temporaryDirectories.push(root);
  const options = {
    cwd: root,
    agentDir: join(root, "agent"),
    packageDirectory: join(root, "package"),
    projectTrusted: true,
  };
  await writeProfile(options.packageDirectory, "explore", manifest());
  const catalogue = await discoverProfileCatalogue(options);
  const entry = catalogue.profiles[0];
  if (!entry) throw new Error("Expected explore profile.");
  return {
    options,
    catalogue,
    entry,
    section: createProfileSettingsSection(entry, catalogue),
    profilePath: join(options.agentDir, "supi", "agents", "explore", "profile.json"),
  };
}

describe("profile enablement settings", () => {
  it("inherits enablement by scope and removes only the reset field", async () => {
    const { options, section, profilePath } = await profileSettings();
    const global = { scope: "global" as const, cwd: options.cwd, fieldKey: "enabled" };
    const project = { ...global, scope: "project" as const };
    await section.apply({ ...global, action: { kind: "set", value: "off" } });
    expect((await section.read(project)).rows[0]).toMatchObject({
      editValue: "off",
      source: "global",
    });
    await section.apply({ ...project, action: { kind: "set", value: "on" } });
    expect((await section.read(project)).rows[0]).toMatchObject({
      editValue: "on",
      source: "project",
      inheritanceSource: "global",
    });
    expect((await section.read(global)).rows[0]).toMatchObject({ editValue: "off" });
    expect((await discoverProfileCatalogue(options)).profileIds).toEqual(["explore"]);

    const resetResult = await section.apply({ ...project, action: { kind: "unset" } });
    expect(resetResult.notice?.message).toContain("/reload");
    expect((await section.read(project)).rows[0]).toMatchObject({
      editValue: "off",
      source: "global",
    });
    expect((await discoverProfileCatalogue(options)).profileIds).toEqual([]);
    await expect(
      readFile(join(options.cwd, ".pi", "supi", "agents", "explore", "profile.json")),
    ).rejects.toThrow();

    await section.apply({
      ...global,
      fieldKey: "model",
      action: { kind: "set", value: "openai/test" },
    });
    expect(JSON.parse(await readFile(profilePath, "utf8"))).toEqual({
      enabled: false,
      model: "openai/test",
    });
    await section.apply({ ...global, action: { kind: "unset" } });
    expect(JSON.parse(await readFile(profilePath, "utf8"))).toEqual({ model: "openai/test" });
    expect((await section.read(project)).rows[0]).toMatchObject({
      editValue: "on",
      source: "default",
    });
  });

  it("saves a boolean override with a reload notice and keeps current choices fixed", async () => {
    const { options, catalogue, entry, section, profilePath } = await profileSettings();
    const request = { scope: "global" as const, cwd: options.cwd };
    expect((await section.read(request)).rows[0]).toMatchObject({
      field: { kind: "boolean", key: "enabled", label: "Enabled" },
      displayValue: "on (default)",
      editValue: "on",
      source: "default",
    });

    const result = await section.apply({
      ...request,
      fieldKey: "enabled",
      action: { kind: "set", value: "off" },
    });
    expect(result.notice).toMatchObject({
      level: "info",
      message: expect.stringContaining("/reload"),
    });
    expect(JSON.parse(await readFile(profilePath, "utf8"))).toEqual({ enabled: false });
    expect((await section.read(request)).rows[0]).toMatchObject({
      displayValue: "off (global)",
      editValue: "off",
      source: "global",
    });
    expect(catalogue.profileIds).toEqual(["explore"]);
    expect(resolveProfileDefinition(entry, catalogue.sourceDirectories)).toMatchObject({
      manifest: { enabled: true },
    });

    const reloaded = await discoverProfileCatalogue(options);
    expect(reloaded.profileIds).toEqual([]);
    const disabledSection = createProfileSettingsSections(reloaded)[0];
    if (!disabledSection) throw new Error("Expected disabled profile in settings.");
    expect((await disabledSection.read(request)).rows[0]).toMatchObject({ editValue: "off" });
    await disabledSection.apply({
      ...request,
      fieldKey: "enabled",
      action: { kind: "set", value: "on" },
    });
    expect(reloaded.profileIds).toEqual([]);
    expect((await discoverProfileCatalogue(options)).profileIds).toEqual(["explore"]);
  });
});
