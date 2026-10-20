// Code Intelligence configuration and settings registration.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type CFamilyFileAssociationResolver,
  createCFamilyFileAssociationResolver,
} from "@mrclrchtr/supi-code-runtime/api";
import {
  getSupiConfigPath,
  loadAutomaticExclusionPatterns,
  loadSupiConfig,
  loadSupiConfigForScope,
  loadSupiConfigSectionForScope,
} from "@mrclrchtr/supi-core/config";
import {
  defineConfigSettings,
  registerSettings,
  type SettingsModule,
} from "@mrclrchtr/supi-core/settings";

const CODE_INTELLIGENCE_SECTION = "code-intelligence";

/** User-facing configuration for the code-intelligence extension. */
export interface CodeIntelligenceConfig extends Record<string, unknown> {
  /** Ordered directory-local instruction file names to surface during directory orientation. */
  instructionFileNames: string[];
  /** Inject the hidden first-turn workspace overview when enabled. */
  overviewEnabled: boolean;
  /** Gitignore-style paths excluded from automatic navigation, LSP, and broad AST work. */
  exclude: string[];
}

/** Default code-intelligence configuration. */
export const CODE_INTELLIGENCE_DEFAULTS: CodeIntelligenceConfig = {
  instructionFileNames: ["CLAUDE.md", "AGENTS.md"],
  overviewEnabled: true,
  exclude: [],
};

/** Load merged code-intelligence configuration for a workspace. */
export function loadCodeIntelligenceConfig(
  cwd: string,
  homeDir?: string,
  projectTrusted = true,
): CodeIntelligenceConfig {
  const loaded = projectTrusted
    ? loadSupiConfig(CODE_INTELLIGENCE_SECTION, cwd, CODE_INTELLIGENCE_DEFAULTS, { homeDir })
    : loadSupiConfigForScope(CODE_INTELLIGENCE_SECTION, cwd, CODE_INTELLIGENCE_DEFAULTS, {
        scope: "global",
        homeDir,
      });
  return loaded;
}

/**
 * Load C-family associations from trusted project configuration only.
 *
 * `fileAssociations` is an ordered array of `{ pattern, language }` rules.
 * Patterns are case-sensitive globs. Use `*`, `?`, `**`, character classes,
 * and brace alternatives. Patterns
 * match POSIX-style paths relative to the workspace root. The first match
 * wins. A rule accepts
 * only `c` or `cpp` and only changes an existing C-family suffix. Global
 * values do not apply. An untrusted project returns the default mapping
 * without reading its configuration. The workspace host keeps this resolver
 * until its last provider lease ends.
 *
 * @throws If a trusted project rule is invalid.
 */
export function loadProjectFileAssociations(
  cwd: string,
  projectTrusted: boolean,
): CFamilyFileAssociationResolver {
  if (!projectTrusted) return createCFamilyFileAssociationResolver(cwd);
  const section = loadSupiConfigSectionForScope("code-intelligence", cwd, {
    scope: "project",
  });
  if (!section || !Object.hasOwn(section, "fileAssociations")) {
    return createCFamilyFileAssociationResolver(cwd);
  }
  try {
    return createCFamilyFileAssociationResolver(cwd, section.fileAssociations);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid trusted project configuration in ${getSupiConfigPath("project", cwd)}: ${detail}`,
      { cause: error },
    );
  }
}

/**
 * Resolve the overview setting for one session boundary.
 *
 * Project-scoped values apply only when the project is trusted. Only a strict
 * boolean `true` enables injection; malformed values fail closed. Unreadable
 * files and non-object sections use the shared config-loader defaults.
 */
export function resolveOverviewEnabled(
  cwd: string,
  projectTrusted: boolean,
  homeDir?: string,
): boolean {
  const config = loadCodeIntelligenceConfig(cwd, homeDir, projectTrusted);
  return config.overviewEnabled === true;
}

/** Register code-intelligence settings with the shared SuPi settings registry. */
export function registerCodeIntelligenceSettings(pi: ExtensionAPI, homeDir?: string): void {
  const module = defineConfigSettings({
    id: CODE_INTELLIGENCE_SECTION,
    label: "Code Intelligence",
    section: CODE_INTELLIGENCE_SECTION,
    defaults: CODE_INTELLIGENCE_DEFAULTS,
    fields: [
      {
        kind: "stringList" as const,
        key: "instructionFileNames",
        label: "Instruction File Names",
        description: "Directory-local instruction file names shown by directory orientation",
      },
      {
        kind: "boolean" as const,
        key: "overviewEnabled",
        label: "Overview Enabled",
        description: "Inject the hidden first-turn workspace overview",
      },
      {
        kind: "stringList" as const,
        key: "exclude",
        label: "Automatic Exclusions",
        description:
          "Gitignore-style patterns for automatic navigation, LSP, and broad AST work. Reload or restart Pi for runtime scans; exact requests stay available.",
      },
    ],
    ...(homeDir ? { homeDir } : {}),
  });
  registerSettings(pi, {
    ...module,
    async read(context: Parameters<SettingsModule["read"]>[0]) {
      loadAutomaticExclusionPatterns(context.cwd, {
        homeDir,
        projectTrusted: context.ctx?.isProjectTrusted() ?? true,
      });
      return module.read(context);
    },
  });
}
