import { type ExtensionUIContext, initTheme } from "@earendil-works/pi-coding-agent";
import {
  createEmptySessionCapabilityState,
  resolveSessionCapabilityProfiles,
} from "@mrclrchtr/supi-core/session";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createCapabilitySelector } from "../../src/session-capabilities-ui.ts";
import { buildCapabilityProfileRows } from "../../src/session-capability-profile-ui.ts";

function makeSelector(projectTrusted = true) {
  const catalog = {
    ...resolveSessionCapabilityProfiles({
      global: {
        profiles: {
          research: { excludedTools: ["agent_run", "future_tool"], hiddenSkills: ["future-skill"] },
          broken: {},
        },
      },
      project: {
        profiles: { research: { hiddenSkills: ["implement"] }, broken: { unknown: true } },
      },
      projectTrusted,
    }),
    defaultValues: { global: "research", project: null },
  };
  const tools = [{ name: "agent_run", description: "Run an agent", source: "agents" }];
  const skills = [{ name: "implement", description: "Implement a change" }];
  const done = vi.fn();
  const onChange = vi.fn();
  const selector = createCapabilitySelector({
    done,
    onChange,
    tools,
    skills,
    state: createEmptySessionCapabilityState(),
    theme: { fg: (_color, text) => text, bold: (text) => text } as ExtensionUIContext["theme"],
    tui: { requestRender: vi.fn() },
    initialSection: "profiles",
    profileRows: buildCapabilityProfileRows({ catalog, tools, skills, projectTrusted }),
  });
  return { selector, done, onChange };
}

beforeAll(() => initTheme("dark"));

describe("profile catalog in the session selector", () => {
  it("shows scoped defaults and exact exclusions with unmatched names", () => {
    const { selector } = makeSelector();
    let text = selector.render(160).join("\n");
    expect(text).toContain("Save current as");
    expect(text).toContain("Global default");
    expect(text).toContain("Project default");
    expect(text).toContain("None (explicit)");
    selector.handleInput("research");
    selector.handleInput("\u001b[B");
    text = selector.render(160).join("\n");
    expect(text).toContain("Source: global");
    expect(text).toContain("Shadowed");
    expect(text).toContain('Excluded tools: ["agent_run","future_tool"]');
    expect(text).toContain('Unmatched tools: ["future_tool"]');
    expect(text).toContain('Hidden skills: ["future-skill"]');
    expect(text).toContain('Unmatched skills: ["future-skill"]');
  });

  it("allows replacement and deletion of a shadowed global profile, but not application", () => {
    const { selector, done, onChange } = makeSelector();
    selector.handleInput("research");
    selector.handleInput("\u001b[B");
    selector.handleInput("\r");
    const text = selector.render(160).join("\n");
    expect(text).toContain("Replace saved profile");
    expect(text).toContain("Delete profile");
    expect(text).not.toContain("Apply profile");
    selector.handleInput("\r");
    expect(done).toHaveBeenCalledExactlyOnceWith({
      id: "profile:global:research",
      value: "replace",
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("returns the effective project's apply action", () => {
    const { selector, done } = makeSelector();
    selector.handleInput("research");
    selector.handleInput("\u001b[B");
    selector.handleInput("\u001b[B");
    expect(selector.render(160).join("\n")).toContain("Source: project");
    selector.handleInput("\r");
    expect(selector.render(160).join("\n")).toContain("Apply profile");
    selector.handleInput("\r");
    expect(done).toHaveBeenCalledExactlyOnceWith({
      id: "profile:project:research",
      value: "apply",
    });
  });

  it("shows an invalid project definition and its error without an apply action", () => {
    const { selector, done } = makeSelector();
    selector.handleInput("broken");
    selector.handleInput("\u001b[B");
    let text = selector.render(160).join("\n");
    expect(text).toContain("Invalid");
    expect(text).toContain("Source: project");
    expect(text).toContain("Unknown profile field: unknown.");
    selector.handleInput("\r");
    text = selector.render(160).join("\n");
    expect(text).not.toContain("Apply profile");
    expect(text).toContain("Replace saved profile");
    selector.handleInput("\u001b[B");
    selector.handleInput("\r");
    expect(done).toHaveBeenCalledExactlyOnceWith({ id: "profile:project:broken", value: "delete" });
  });

  it("shows configuration errors as information rows", () => {
    const { selector, done, onChange } = makeSelector();
    selector.handleInput("Configuration error");
    expect(selector.render(160).join("\n")).toContain("profiles.broken: Unknown profile field");
    selector.handleInput("\r");
    selector.handleInput(" ");
    expect(done).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("omits project rows when the project is not trusted", () => {
    const { selector, done } = makeSelector(false);
    expect(selector.render(160).join("\n")).not.toContain("Project default");
    selector.handleInput("research");
    selector.handleInput("\u001b[B");
    expect(selector.render(160).join("\n")).not.toContain("Shadowed");
    selector.handleInput("\r");
    expect(selector.render(160).join("\n")).toContain("Apply profile");
    selector.handleInput("\r");
    expect(done).toHaveBeenCalledExactlyOnceWith({ id: "profile:global:research", value: "apply" });
  });

  it.each(["Global", "Project"])("returns the %s default action", (scope) => {
    const { selector, done, onChange } = makeSelector();
    selector.handleInput(`${scope} default`);
    selector.handleInput("\r");
    selector.handleInput("\r");
    expect(done).toHaveBeenCalledExactlyOnceWith({
      id: `profile:default:${scope.toLowerCase()}`,
      value: "set-default",
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
