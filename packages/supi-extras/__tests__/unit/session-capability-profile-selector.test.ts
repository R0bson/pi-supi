import { type ExtensionUIContext, initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createEmptySessionCapabilityState } from "@mrclrchtr/supi-core/session";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createCapabilitySelector } from "../../src/session-capabilities-ui.ts";
import type { CapabilityRow } from "../../src/session-capabilities-ui-rows.ts";

const profileRows: CapabilityRow[] = [
  {
    id: "profile:save",
    label: "Save current as",
    currentValue: "Save",
    indent: 2,
    searchText: "Save current as",
    actions: [{ value: "save", label: "Save current as" }],
  },
  {
    id: "profile:global:research",
    label: "research",
    currentValue: "global",
    description: "Source: global. Excluded tools: agent_run. Hidden skills: implement.",
    indent: 2,
    searchText: "research global",
    actions: [{ value: "apply", label: "Apply profile" }],
  },
];

function makeSelector(options: Partial<Parameters<typeof createCapabilitySelector>[0]> = {}) {
  const state = createEmptySessionCapabilityState();
  state.profileSnapshot = {
    id: "research",
    source: "global",
    excludedTools: [],
    hiddenSkills: [],
  };
  const done = vi.fn();
  const onChange = vi.fn((id: string, value: string) => {
    if (id === "tool:agent_run") state.toolDenylist = value === "Disabled" ? ["agent_run"] : [];
    if (id === "skill:implement") state.hiddenSkillNames = value === "Hidden" ? ["implement"] : [];
  });
  const selector = createCapabilitySelector({
    done,
    onChange,
    state,
    skills: [{ name: "implement", description: "Implement a change" }],
    tools: [{ name: "agent_run", description: "Run an agent", source: "agents" }],
    theme: { fg: (_color, text) => text, bold: (text) => text } as ExtensionUIContext["theme"],
    tui: { requestRender: vi.fn() },
    profileRows,
    ...options,
  });
  return { selector, done, onChange, state };
}

beforeAll(() => initTheme("dark"));

describe("session capability profile selector", () => {
  it("cycles Tools, Skills, and Profiles, then returns to Tools", () => {
    const { selector } = makeSelector();
    expect(selector.render(120)[1]).toContain("[Tools]");
    selector.handleInput("\t");
    expect(selector.render(120)[1]).toContain("[Skills]");
    selector.handleInput("\t");
    expect(selector.render(120)[1]).toContain("[Profiles]");
    expect(selector.render(120).join("\n")).toContain("Save current as");
    selector.handleInput("\t");
    expect(selector.render(120)[1]).toContain("[Tools]");
  });

  it("opens in Profiles and supports reverse tab navigation", () => {
    const { selector } = makeSelector({ initialSection: "profiles" });
    expect(selector.render(120)[1]).toContain("[Profiles]");
    selector.handleInput("\u001b[Z");
    expect(selector.render(120)[1]).toContain("[Skills]");
    selector.handleInput("\u001b[Z");
    selector.handleInput("\u001b[Z");
    expect(selector.render(120)[1]).toContain("[Profiles]");
  });

  it("shows the snapshot name and source, and updates Modified after manual changes", () => {
    const { selector, done, onChange } = makeSelector();
    expect(selector.render(120)[1]).toContain("research (global)");
    expect(selector.render(120)[1]).not.toContain("Modified");
    selector.handleInput("agent_run");
    selector.handleInput("\u001b[B");
    selector.handleInput(" ");
    expect(onChange).toHaveBeenLastCalledWith("tool:agent_run", "Disabled");
    expect(selector.render(120)[1]).toContain("Modified");
    selector.handleInput(" ");
    expect(selector.render(120)[1]).not.toContain("Modified");
    selector.handleInput("\t");
    selector.handleInput("implement");
    selector.handleInput("\r");
    selector.handleInput("\u001b[B");
    selector.handleInput("\r");
    expect(onChange).toHaveBeenLastCalledWith("skill:implement", "Hidden");
    expect(selector.render(120)[1]).toContain("Modified");
    expect(done).not.toHaveBeenCalled();
  });

  it("compares exclusion sets with the snapshot and keeps the title within its width", () => {
    const { selector, state } = makeSelector();
    state.profileSnapshot = {
      id: "code-review",
      source: "project",
      excludedTools: ["future_tool", "agent_run"],
      hiddenSkills: ["future-skill"],
    };
    state.toolDenylist = ["agent_run", "future_tool", "agent_run"];
    state.hiddenSkillNames = ["future-skill"];
    expect(selector.render(120)[1]).toContain("code-review (project)");
    expect(selector.render(120)[1]).not.toContain("Modified");
    expect(visibleWidth(selector.render(40)[1] ?? "")).toBeLessThanOrEqual(40);
    delete state.profileSnapshot;
    expect(selector.render(120)[1]).not.toContain("code-review");
    expect(selector.render(120)[1]).not.toContain("Modified");
  });

  it.each(["profile:save", "profile:default:global", "profile:global:research"])(
    "returns %s through done instead of onChange",
    (id) => {
      const { selector, done, onChange } = makeSelector({
        initialSection: "profiles",
        profileRows: [{ ...profileRows[0], id } as CapabilityRow],
      });
      selector.handleInput("\r");
      selector.handleInput("\t");
      expect(selector.render(120)[1]).toContain("[Profiles]");
      expect(done).not.toHaveBeenCalled();
      selector.handleInput("\r");
      expect(done).toHaveBeenCalledExactlyOnceWith({ id, value: "save" });
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("cancels the profile menu before closing the selector", () => {
    const { selector, done } = makeSelector({ initialSection: "profiles" });
    selector.handleInput("\r");
    selector.handleInput("\u001b");
    expect(done).not.toHaveBeenCalled();
    expect(selector.render(120).join("\n")).toContain("research");
    selector.handleInput("\u001b");
    expect(done).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("keeps the two-line header for profile mouse actions", () => {
    const { selector, done, onChange } = makeSelector({ initialSection: "profiles" });
    const click = (y: number) =>
      selector.handleMouse({
        type: "click",
        button: "left",
        x: 0,
        y,
        screenX: 0,
        screenY: y,
        width: 120,
        height: 30,
        shift: false,
        alt: false,
        ctrl: false,
      });
    selector.render(120);
    click(5);
    expect(selector.render(120).join("\n")).toContain("Apply profile");
    click(3);
    expect(done).toHaveBeenCalledExactlyOnceWith({ id: "profile:global:research", value: "apply" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("accepts an omitted profile row list", () => {
    const { selector } = makeSelector({ initialSection: "profiles", profileRows: undefined });
    expect(selector.render(120)[1]).toContain("[Profiles]");
    expect(selector.render(120).join("\n")).toContain("No capabilities available");
  });
});
