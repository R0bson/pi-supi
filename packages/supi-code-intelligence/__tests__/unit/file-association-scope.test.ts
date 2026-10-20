import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSection: vi.fn(),
}));
vi.mock("@mrclrchtr/supi-core/config", () => ({
  getSupiConfigPath: vi.fn(() => "/project/.pi/supi/config.json"),
  loadAutomaticExclusionPatterns: vi.fn(() => []),
  loadSupiConfig: vi.fn(),
  loadSupiConfigForScope: vi.fn(),
  loadSupiConfigSectionForScope: mocks.loadSection,
}));

import { loadProjectFileAssociations } from "../../src/config.ts";

describe("project association scope", () => {
  beforeEach(() => mocks.loadSection.mockReset());
  it("does not read a global association rule", () => {
    mocks.loadSection.mockImplementation((_section, _cwd, options) => {
      if (options?.scope === "global") {
        return { fileAssociations: [{ pattern: "**/*.h", language: "cpp" }] };
      }
      return null;
    });

    const resolver = loadProjectFileAssociations("/project", true);

    expect(resolver.languageForFile("/project/api.h")).toBe("c");
    expect(mocks.loadSection).toHaveBeenCalledExactlyOnceWith("code-intelligence", "/project", {
      scope: "project",
    });
  });

  it("does not read project settings when trust is absent", () => {
    const resolver = loadProjectFileAssociations("/project", false);

    expect(resolver.languageForFile("/project/api.h")).toBe("c");
    expect(mocks.loadSection).not.toHaveBeenCalled();
  });
});
