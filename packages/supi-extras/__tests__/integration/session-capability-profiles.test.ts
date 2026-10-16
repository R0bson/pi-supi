import { initTheme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { capabilitySession, chooseRow } from "../helpers/capability-session.ts";

const sessions: ReturnType<typeof capabilitySession>[] = [];
function setup() {
  const session = capabilitySession();
  sessions.push(session);
  return session;
}
beforeAll(() => initTheme("dark"));
afterEach(() => {
  for (const session of sessions.splice(0)) session.cleanup();
});

describe("capability profile sessions", () => {
  it("applies a profile from the selector and clears its identity on Reset All", async () => {
    const session = setup();
    session.store.save("global", "research", {
      excludedTools: ["first"],
      hiddenSkills: ["missing"],
    });
    await session.event("session_start", { reason: "new" });
    const command = session.open();
    await vi.waitFor(() => expect(session.selector()).toBeDefined());
    const first = session.selector();
    first?.handleInput("\t");
    first?.handleInput("\t");
    chooseRow(first, "research");
    await vi.waitFor(() => expect(session.selector()).not.toBe(first));
    expect(session.active()).toEqual(["read", "second"]);
    expect(session.selector()?.render(160).join("\n")).toContain("research (global)");
    expect(session.state()?.hiddenSkillNames).toEqual(["missing"]);
    session.selector()?.handleInput("\t");
    chooseRow(session.selector(), "Reset All");
    expect(session.active()).toEqual(["read", "second", "first"]);
    expect(session.state()?.profileSnapshot).toBeUndefined();
    expect(session.store.read().effectiveProfiles[0]?.hiddenSkills).toEqual(["missing"]);
    session.selector()?.handleInput("\u001b");
    await command;
  });
  it("applies a new-session default without activating ineligible tools", async () => {
    const session = setup();
    session.store.save("global", "research", {
      excludedTools: ["first", "late", "read", "inactive"],
      hiddenSkills: ["absent-skill"],
    });
    session.store.setDefault("global", "research");
    await session.event("session_start", { reason: "new" });
    expect(session.active()).toEqual(["read", "second"]);
    expect(session.state()).toMatchObject({
      toolDenylist: ["first", "late", "read", "inactive"],
      hiddenSkillNames: ["absent-skill"],
      profileSnapshot: { id: "research", source: "global" },
    });
  });
});
