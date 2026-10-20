import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type SettingsModule, SUPI_SETTINGS_COLLECT_EVENT } from "@mrclrchtr/supi-core/settings";
import { createPiMock, getTools, makeCtx } from "@mrclrchtr/supi-test-utils";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";
import agentExtension from "../../src/extension.ts";
import { writeProfile } from "../helpers/profile-fixtures.ts";

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

async function disabledProfilesSession() {
  const root = await mkdtemp(join(tmpdir(), "supi-agent-profile-session-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(cwd);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("HOME", root);
  await writeProfile(join(agentDir, "supi", "agents"), "explore", { enabled: false });
  await writeProfile(join(agentDir, "supi", "agents"), "general", { enabled: false });
  const pi = createPiMock();
  pi.setActiveTools(["read", "agent_run"]);
  const ctx = makeCtx({ cwd, isProjectTrusted: () => true });
  agentExtension(pi as unknown as ExtensionAPI);
  cleanups.push(() =>
    pi.emit("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx),
  );
  await pi.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
  const sections: SettingsModule[] = [];
  pi.events.emit(SUPI_SETTINGS_COLLECT_EVENT, {
    add(section: SettingsModule) {
      sections.push(section);
    },
  });
  const agentSettings = sections.find((section) => section.id === "agent");
  const profileSettings = sections.find((section) => section.id === "agent-profile-explore");
  if (!agentSettings || !profileSettings) throw new Error("Expected Agent settings.");
  return { pi, ctx, agentSettings, profileSettings, agentDir };
}

function currentTool(pi: ReturnType<typeof createPiMock>) {
  const tool = getTools(pi)
    .filter((entry) => entry.name === "agent_run")
    .at(-1);
  if (!tool) throw new Error("Expected agent_run tool.");
  return tool;
}

describe("profile enablement at the extension boundary", () => {
  it("preserves an off tool setting when a profile becomes available", async () => {
    const { pi, ctx, agentSettings, profileSettings } = await disabledProfilesSession();
    expect(getTools(pi).some((tool) => tool.name === "agent_list")).toBe(true);
    const request = { scope: "project" as const, cwd: ctx.cwd };
    await agentSettings.apply({
      ...request,
      fieldKey: "agentToolEnabled",
      action: { kind: "set", value: "off" },
    });
    await profileSettings.apply({
      ...request,
      fieldKey: "enabled",
      action: { kind: "set", value: "on" },
    });
    await pi.emit("session_start", { type: "session_start", reason: "reload" }, ctx);
    expect(pi.getActiveTools()).toEqual(["read"]);
    expect((await agentSettings.read(request)).rows[0]).toMatchObject({ editValue: "off" });
    await agentSettings.apply({
      ...request,
      fieldKey: "agentToolEnabled",
      action: { kind: "set", value: "on" },
    });
    expect(pi.getActiveTools()).toEqual(["read", "agent_run"]);
  });

  it("keeps profile choices fixed until reload and rejects calls to disabled profiles", async () => {
    const { pi, ctx, profileSettings, agentDir } = await disabledProfilesSession();
    const input = {
      tasks: [{ id: "task", new: { profile: "explore" }, instructions: "Inspect files." }],
    };
    await expect(
      currentTool(pi).execute("call", input, undefined, undefined, ctx as never),
    ).rejects.toThrow("No valid Agent Profiles are available");
    const request = { scope: "project" as const, cwd: ctx.cwd, fieldKey: "enabled" };
    await profileSettings.apply({ ...request, action: { kind: "set", value: "on" } });
    await writeProfile(join(agentDir, "supi", "agents"), "general", { enabled: true });
    await pi.emit("session_start", { type: "session_start", reason: "reload" }, ctx);
    const before = currentTool(pi);
    expect(Value.Check(before.parameters as TSchema, input)).toBe(true);

    await profileSettings.apply({ ...request, action: { kind: "set", value: "off" } });
    expect(Value.Check(currentTool(pi).parameters as TSchema, input)).toBe(true);
    await pi.emit("session_start", { type: "session_start", reason: "reload" }, ctx);
    const after = currentTool(pi);
    expect(Value.Check(after.parameters as TSchema, input)).toBe(false);
    expect(JSON.stringify(after.parameters)).not.toContain("explore");
    expect(
      Value.Check(after.parameters as TSchema, {
        tasks: [{ id: "task", new: { profile: "general" }, instructions: "Inspect files." }],
      }),
    ).toBe(true);
    await expect(after.execute("call", input, undefined, undefined, ctx as never)).rejects.toThrow(
      "Invalid agent_run input",
    );
    expect(pi.getActiveTools()).toEqual(["read", "agent_run"]);

    await writeProfile(join(agentDir, "supi", "agents"), "general", { enabled: false });
    expect(pi.getActiveTools()).toEqual(["read", "agent_run"]);
    await pi.emit("session_start", { type: "session_start", reason: "reload" }, ctx);
    expect(pi.getActiveTools()).toEqual(["read"]);
  });

  it("keeps agent_run inactive without usable profiles and activates it after reload", async () => {
    const { pi, ctx, agentSettings, profileSettings } = await disabledProfilesSession();
    const request = { scope: "project" as const, cwd: ctx.cwd };
    expect(pi.getActiveTools()).toEqual(["read"]);
    await agentSettings.apply({
      ...request,
      fieldKey: "agentToolEnabled",
      action: { kind: "set", value: "on" },
    });
    expect(pi.getActiveTools()).toEqual(["read"]);
    expect((await agentSettings.read(request)).rows[0]).toMatchObject({ editValue: "on" });

    await profileSettings.apply({
      ...request,
      fieldKey: "enabled",
      action: { kind: "set", value: "on" },
    });
    expect(pi.getActiveTools()).toEqual(["read"]);
    await pi.emit("session_start", { type: "session_start", reason: "reload" }, ctx);
    expect(pi.getActiveTools()).toEqual(["read", "agent_run"]);
  });
});
