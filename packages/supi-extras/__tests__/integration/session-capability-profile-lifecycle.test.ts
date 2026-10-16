import { initTheme } from "@earendil-works/pi-coding-agent";
import { replaceSupiConfigSection } from "@mrclrchtr/supi-core/config";
import {
  createEmptySessionCapabilityState,
  isSessionCapabilityProfileModified,
  SESSION_CAPABILITIES_ENTRY,
} from "@mrclrchtr/supi-core/session";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { capabilitySession } from "../helpers/capability-session.ts";

const sessions: ReturnType<typeof capabilitySession>[] = [];

function setup() {
  const session = capabilitySession();
  sessions.push(session);
  return session;
}

beforeAll(() => initTheme("dark"));
afterEach(() => {
  for (const session of sessions.splice(0)) session.cleanup();
  vi.restoreAllMocks();
});

describe("capability profile startup", () => {
  it.each(["new", "startup"])(
    "applies the default on %s with initial Pi metadata",
    async (reason) => {
      const session = setup();
      session.entries.push(
        { type: "model_change", provider: "example", modelId: "test" },
        { type: "thinking_level_change", thinkingLevel: "off" },
      );
      session.store.save("global", "research", {
        excludedTools: ["first", "late", "read", "inactive"],
        hiddenSkills: ["absent-skill"],
      });
      session.store.setDefault("global", "research");

      await session.event("session_start", { reason });

      expect(session.active()).toEqual(["read", "second"]);
      expect(session.state()).toMatchObject({
        toolDenylist: ["first", "late", "read", "inactive"],
        hiddenSkillNames: ["absent-skill"],
        profileSnapshot: { id: "research", source: "global" },
      });
      expect(session.entries.at(-1)?.data).toEqual(session.state());
      expect(session.ctx.ui.custom).not.toHaveBeenCalled();
    },
  );

  it.each(["message", "custom_message", "compaction", "branch_summary", "context_edit"])(
    "does not apply a startup default with prior %s history on any branch",
    async (type) => {
      const session = setup();
      session.store.save("global", "research", { excludedTools: ["first"] });
      session.store.setDefault("global", "research");
      session.entries.push({ type, id: "old-branch", parentId: null });
      session.ctx.sessionManager.getBranch = () => [];
      await session.event("session_start", { reason: "startup" });
      expect(session.active()).toEqual(["read", "first", "second"]);
      expect(session.state()?.profileSnapshot).toBeUndefined();
    },
  );

  it("does not apply a startup default to a fork with only metadata", async () => {
    const session = setup();
    session.store.save("global", "research", { excludedTools: ["first"] });
    session.store.setDefault("global", "research");
    session.ctx.sessionManager.getHeader = () => ({
      type: "session",
      id: session.root,
      cwd: session.cwd,
      timestamp: new Date().toISOString(),
      parentSession: "/source.jsonl",
    });
    await session.event("session_start", { reason: "startup" });
    expect(session.active()).toEqual(["read", "first", "second"]);
    expect(session.state()?.profileSnapshot).toBeUndefined();
  });

  it.each(["startup", "resume", "reload", "fork"])(
    "keeps old capability state without a profile on %s",
    async (reason) => {
      const session = setup();
      session.store.save("global", "research", { excludedTools: ["second"] });
      session.store.setDefault("global", "research");
      session.entries.push({
        type: "custom",
        customType: SESSION_CAPABILITIES_ENTRY,
        data: {
          ...createEmptySessionCapabilityState(),
          eligibleToolNames: ["first", "second"],
          toolDenylist: ["first"],
          hiddenSkillNames: ["missing"],
        },
      });
      await session.event("session_start", { reason });
      expect(session.active()).toEqual(["read", "second"]);
      expect(session.state()).toMatchObject({
        toolDenylist: ["first"],
        hiddenSkillNames: ["missing"],
      });
      expect(session.state()?.profileSnapshot).toBeUndefined();
    },
  );

  it.each(["resume", "reload", "fork"])("does not apply a default on empty %s", async (reason) => {
    const session = setup();
    session.store.save("global", "research", { excludedTools: ["first"] });
    session.store.setDefault("global", "research");
    await session.event("session_start", { reason });
    expect(session.active()).toEqual(["read", "first", "second"]);
    expect(session.state()?.profileSnapshot).toBeUndefined();
  });
});

describe("capability profile session copies", () => {
  it.each(["startup", "resume", "reload"])(
    "keeps a project snapshot on %s after edits, deletion, and trust loss",
    async (reason) => {
      const session = setup();
      session.store.save("project", "research", {
        excludedTools: ["first"],
        hiddenSkills: ["missing"],
      });
      session.store.setDefault("project", "research");
      await session.event("session_start", { reason: "new" });
      const original = session.state();
      session.store.save("global", "other", { excludedTools: ["second"] });
      session.store.setDefault("global", "other");
      for (const change of ["edit", "delete", "trust"] as const) {
        if (change === "edit")
          session.store.save("project", "research", { excludedTools: ["second"] }, true);
        if (change === "delete") session.store.delete("project", "research");
        if (change === "trust") session.ctx.isProjectTrusted = () => false;
        await session.event("session_shutdown", { reason: "reload" });
        session.pi.setActiveTools(["read", "first", "second"]);
        await session.event("session_start", { reason });
        expect(session.active()).toEqual(["read", "second"]);
        expect(session.state()).toEqual(original);
        expect(session.ctx.ui.notify).not.toHaveBeenCalled();
        const state = session.state();
        if (!state) throw new Error("Session state is missing");
        expect(isSessionCapabilityProfileModified(state)).toBe(false);
      }
      await session.event("session_shutdown", { reason: "new" });
      session.entries.length = 0;
      session.pi.setActiveTools(["read", "first", "second"]);
      await session.event("session_start", { reason: "new" });
      expect(session.active()).toEqual(["read", "first"]);
      expect(session.state()?.profileSnapshot).toMatchObject({ id: "other", source: "global" });
    },
  );

  it("copies the current snapshot to a fork without a capability entry", async () => {
    const source = setup();
    const fork = setup();
    source.store.save("global", "research", {
      excludedTools: ["first"],
      hiddenSkills: ["missing"],
    });
    source.store.setDefault("global", "research");
    await source.event("session_start", { reason: "new" });
    const original = source.state();
    fork.store.save("global", "other", { excludedTools: ["second"] });
    fork.store.setDefault("global", "other");
    await source.event("session_before_fork", { entryId: "before-profile", position: "before" });
    await source.event("session_shutdown", { reason: "fork" });
    await fork.event("session_start", { reason: "fork" });
    expect(fork.state()).toEqual(original);
    expect(fork.entries.at(-1)?.data).toEqual(original);
    expect(fork.active()).toEqual(["read", "second"]);
  });

  it("keeps session-wide state when tree navigation reaches an older capability entry", async () => {
    const session = setup();
    await session.event("session_start", { reason: "new" });
    const earlier = session.entries[0];
    session.store.save("global", "research", { excludedTools: ["first"] });
    session.store.setDefault("global", "research");
    await session.event("session_start", { reason: "new" });
    const original = session.state();
    session.store.save("global", "research", { excludedTools: ["second"] }, true);
    session.ctx.sessionManager.getBranch = vi.fn(() => [earlier] as never);
    session.pi.setActiveTools(["read", "first", "second"]);
    await session.event("session_tree", { newLeafId: "earlier", oldLeafId: "latest" });
    expect(session.active()).toEqual(["read", "second"]);
    expect(session.state()).toEqual(original);
    expect(session.ctx.sessionManager.getBranch).not.toHaveBeenCalled();
  });
});

describe("late capability profile tools", () => {
  it.each(["before_agent_start", "session_tree"])(
    "applies exact exclusions before %s and saves new eligibility",
    async (event) => {
      const session = setup();
      session.store.save("global", "research", {
        excludedTools: ["first", "late", "read", "sdk-tool", "inactive"],
      });
      session.store.setDefault("global", "research");
      await session.event("session_start", { reason: "new" });
      const snapshot = session.state()?.profileSnapshot;
      const savedCount = session.entries.length;
      for (const name of ["late", "unlisted", "sdk-tool"]) {
        session.tools.push({
          name,
          description: name,
          sourceInfo: { source: name === "sdk-tool" ? "sdk" : "example", path: `/${name}.ts` },
        });
      }
      session.pi.setActiveTools([...session.active(), "late", "unlisted", "sdk-tool", "inactive"]);

      await session.event(event, { newLeafId: "earlier", oldLeafId: "latest" });

      expect(session.active()).toEqual(["read", "second", "unlisted", "sdk-tool", "inactive"]);
      expect(session.state()?.eligibleToolNames).toEqual(["first", "second", "late", "unlisted"]);
      expect(session.state()?.profileSnapshot).toEqual(snapshot);
      expect(session.entries).toHaveLength(savedCount + 1);
      expect(session.entries.at(-1)?.data).toEqual(session.state());
      await session.event(event, {});
      expect(session.entries).toHaveLength(savedCount + 1);

      await session.event("session_shutdown", { reason: "reload" });
      session.pi.setActiveTools([...session.active(), "first", "late"]);
      await session.event("session_start", { reason: "reload" });
      expect(session.active()).not.toContain("late");
      expect(session.active()).toContain("unlisted");
      expect(session.state()?.eligibleToolNames).toContain("late");
    },
  );
});

describe("capability profile defaults run once", () => {
  it("keeps normal startup when a default is configured later", async () => {
    const session = setup();
    session.store.save("global", "research", { excludedTools: ["first"] });
    await session.event("session_start", { reason: "startup" });
    const original = session.state();
    expect(session.active()).toEqual(["read", "first", "second"]);
    expect(original?.profileSnapshot).toBeUndefined();
    session.store.setDefault("global", "research");
    await session.event("session_shutdown", { reason: "quit" });
    await session.event("session_start", { reason: "startup" });
    expect(session.state()).toEqual(original);
    expect(session.active()).toEqual(["read", "first", "second"]);
  });

  it("keeps unmatched exclusions without a skill provider when the selector opens and refreshes", async () => {
    const session = setup();
    session.store.save("global", "research", {
      excludedTools: ["missing-tool"],
      hiddenSkills: ["missing-skill"],
    });
    session.store.setDefault("global", "research");
    await session.event("session_start", { reason: "new" });
    const original = session.state();
    for (let index = 0; index < 2; index++) {
      const opened = session.open();
      await vi.waitFor(() => expect(session.ctx.ui.custom).toHaveBeenCalledTimes(index + 1));
      session.selector()?.handleInput("\t");
      session.selector()?.handleInput("\u001b");
      await opened;
      await session.event("before_agent_start", {});
      expect(session.state()).toEqual(original);
      expect(session.entries.at(-1)?.data).toEqual(original);
    }
  });
});

describe("capability profile mode boundaries", () => {
  it.each(["print", "json"] as const)("applies a default without UI in %s mode", async (mode) => {
    const session = setup();
    session.ctx.mode = mode;
    session.ctx.hasUI = false;
    session.store.save("global", "research", { excludedTools: ["first"] });
    session.store.setDefault("global", "research");
    await session.event("session_start", { reason: "startup" });
    expect(session.active()).toEqual(["read", "second"]);
    expect(session.state()?.profileSnapshot?.id).toBe("research");
    expect(session.ctx.ui.notify).not.toHaveBeenCalled();
    await session.open();
    expect(session.ctx.ui.notify).toHaveBeenCalledWith(
      "/supi-capabilities requires TUI mode",
      "warning",
    );
    expect(session.ctx.ui.custom).not.toHaveBeenCalled();
    expect(session.ctx.waitForIdle).not.toHaveBeenCalled();
  });

  it.each([
    ["print", "missing"],
    ["json", "missing"],
    ["print", "invalid"],
    ["json", "invalid"],
  ] as const)("warns in %s mode for a %s default without applying it", async (mode, kind) => {
    const session = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    session.ctx.mode = mode;
    session.ctx.hasUI = false;
    replaceSupiConfigSection(
      { section: "sessionCapabilities", scope: "global", cwd: session.cwd },
      {
        defaultProfile: "research",
        profiles: kind === "missing" ? {} : { research: { excludedTools: 1 } },
      },
      { homeDir: session.homeDir },
    );
    await session.event("session_start", { reason: "startup" });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Default profile research is missing or invalid"),
    );
    expect(session.active()).toEqual(["read", "first", "second"]);
    expect(session.state()?.toolDenylist).toEqual([]);
    expect(session.state()?.profileSnapshot).toBeUndefined();
    expect(session.ctx.ui.notify).not.toHaveBeenCalled();
    expect(session.ctx.ui.custom).not.toHaveBeenCalled();
  });

  it("waits for idle before opening UI and reads the state after the wait", async () => {
    const session = setup();
    await session.event("session_start", { reason: "new" });
    session.ctx.isIdle = () => false;
    session.ctx.abort = vi.fn();
    let releaseIdle = () => {};
    session.ctx.waitForIdle = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseIdle = resolve;
        }),
    );
    const opened = session.open();
    expect(session.ctx.ui.notify).toHaveBeenCalledWith(
      "Waiting for the agent to become idle.",
      "info",
    );
    expect(session.ctx.waitForIdle).toHaveBeenCalledOnce();
    expect(session.ctx.ui.custom).not.toHaveBeenCalled();
    session.store.save("global", "research", { excludedTools: ["first"] });
    session.store.setDefault("global", "research");
    await session.event("session_start", { reason: "new" });
    releaseIdle();
    await vi.waitFor(() => expect(session.ctx.ui.custom).toHaveBeenCalledOnce());
    expect(session.selector()?.render(160).join("\n")).toContain("research (global)");
    expect(session.ctx.abort).not.toHaveBeenCalled();
    session.selector()?.handleInput("\u001b");
    await opened;
  });
});
