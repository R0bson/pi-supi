import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  captureSessionCapabilityExclusions,
  type SessionCapabilityProfileEntry,
  type SessionCapabilityProfileScope,
  type SessionCapabilityProfileSnapshot,
  type SessionCapabilitySkill,
  type SessionCapabilityState,
} from "@mrclrchtr/supi-core/session";
import type { CapabilityProfileAction } from "./session-capabilities-ui.ts";
import type { CapabilityRow, CapabilityToolItem } from "./session-capabilities-ui-rows.ts";
import type {
  CapabilityProfileCatalog,
  createCapabilityProfileStore,
} from "./session-capability-profile-store.ts";

/** Current configuration and eligible inventories for profile details. */
interface ProfileRowOptions {
  catalog: CapabilityProfileCatalog;
  tools: CapabilityToolItem[];
  skills: SessionCapabilitySkill[] | undefined;
  projectTrusted: boolean;
}

/** Dialog context and session state. Only apply can change the session. */
interface ProfileActionOptions {
  ctx: ExtensionCommandContext;
  store: ReturnType<typeof createCapabilityProfileStore>;
  state: SessionCapabilityState;
  apply(profile: SessionCapabilityProfileSnapshot): void;
}

function defaultRow(
  scope: SessionCapabilityProfileScope,
  catalog: CapabilityProfileCatalog,
): CapabilityRow {
  const value = catalog.defaultValues[scope];
  const label = `${scope === "global" ? "Global" : "Project"} default`;
  const currentValue =
    value === undefined
      ? scope === "project"
        ? "Inherit global"
        : "None (not set)"
      : value === null
        ? "None (explicit)"
        : typeof value === "string"
          ? value
          : "Invalid";
  return {
    id: `profile:default:${scope}`,
    label,
    currentValue,
    description: `Source: ${scope}. Stored default: ${JSON.stringify(value) ?? "absent"}. Changes apply only to new sessions.`,
    indent: 2,
    searchText: `${label} ${currentValue}`,
    actions: [{ value: "set-default", label: "Set default" }],
  };
}

function profileRow(
  entry: SessionCapabilityProfileEntry,
  options: ProfileRowOptions,
): CapabilityRow {
  const status = [
    entry.source,
    ...(entry.shadowed ? ["Shadowed"] : []),
    ...(!entry.profile ? ["Invalid"] : []),
  ];
  const details = [
    `Source: ${entry.source}.${entry.shadowed ? " Shadowed by the project definition; cannot apply." : ""}`,
  ];
  if (entry.profile) {
    const { excludedTools, hiddenSkills } = entry.profile;
    const toolNames = new Set(options.tools.map((tool) => tool.name));
    const skillNames = new Set(options.skills?.map((skill) => skill.name));
    const unmatchedTools = excludedTools.filter((name) => !toolNames.has(name));
    const unmatchedSkills = hiddenSkills.filter((name) => !skillNames.has(name));
    details.push(
      `Excluded tools: ${JSON.stringify(excludedTools)}. Unmatched tools: ${JSON.stringify(unmatchedTools)}.`,
      `Hidden skills: ${JSON.stringify(hiddenSkills)}. Unmatched skills: ${JSON.stringify(unmatchedSkills)}.`,
    );
  }
  details.push(...entry.errors.map((error) => `${error.path}: ${error.message}`));
  return {
    id: `profile:${entry.source}:${entry.id}`,
    label: entry.id,
    currentValue: status.join(" · "),
    description: details.join("\n"),
    indent: 2,
    searchText: `${entry.id} ${status.join(" ")}`,
    actions: [
      ...(entry.profile && !entry.shadowed ? [{ value: "apply", label: "Apply profile" }] : []),
      { value: "replace", label: "Replace saved profile" },
      { value: "delete", label: "Delete profile" },
    ],
  };
}

/** Build scoped profile rows, including invalid and shadowed definitions. */
export function buildCapabilityProfileRows(options: ProfileRowOptions): CapabilityRow[] {
  const { catalog, projectTrusted } = options;
  const rows: CapabilityRow[] = [
    {
      id: "profile:save",
      label: "Save current as",
      currentValue: "Save",
      description:
        "Save current exact exclusions, including unmatched names. Select a scope and a new profile ID. The session does not change.",
      indent: 2,
      searchText: "Save current as",
      actions: [{ value: "save", label: "Save current as" }],
    },
    defaultRow("global", catalog),
    ...(projectTrusted ? [defaultRow("project", catalog)] : []),
  ];
  const entries = catalog.entries
    .filter((entry) => entry.source === "global" || projectTrusted)
    .sort(
      (left, right) => left.id.localeCompare(right.id) || left.source.localeCompare(right.source),
    );
  rows.push(...entries.map((entry) => profileRow(entry, options)));
  for (const [index, error] of catalog.errors.entries()) {
    if (error.scope === "project" && !projectTrusted) continue;
    rows.push({
      id: `profile:error:${index}`,
      label: "Configuration error",
      currentValue: error.scope,
      description: `Source: ${error.scope}. ${error.path}: ${error.message}`,
      indent: 2,
      searchText: `Configuration error ${error.scope} ${error.path} ${error.message}`,
    });
  }
  return rows;
}

function requireEntry(
  catalog: CapabilityProfileCatalog,
  scope: SessionCapabilityProfileScope,
  id: string,
): SessionCapabilityProfileEntry {
  const entry = catalog.entries.find((item) => item.source === scope && item.id === id);
  if (!entry) throw new Error(`Profile ${id} (${scope}) is no longer available.`);
  return entry;
}

async function saveCurrentAs({ ctx, store, state }: ProfileActionOptions): Promise<void> {
  // Require a selection even when Global is the only permitted scope.
  const label = await ctx.ui.select(
    "Save profile in",
    ctx.isProjectTrusted() ? ["Global", "Project"] : ["Global"],
  );
  if (label === undefined) return;
  const scope = label === "Global" ? "global" : label === "Project" ? "project" : undefined;
  if (!scope) throw new Error("Select Global or Project to save a profile.");
  const id = await ctx.ui.input(`New profile ID (${label})`, "code-review");
  if (id === undefined) return;
  store.save(scope, id.trim(), captureSessionCapabilityExclusions(state));
}

async function setDefault(
  scope: SessionCapabilityProfileScope,
  catalog: CapabilityProfileCatalog,
  { ctx, store }: ProfileActionOptions,
): Promise<void> {
  const choices = catalog.effectiveProfiles.map((profile) => ({
    label: `${profile.id} (${profile.source})`,
    value: profile.id as string | null | undefined,
  }));
  choices.push(
    { label: "None", value: null },
    {
      label: scope === "project" ? "Inherit global default" : "Reset global default",
      value: undefined,
    },
  );
  const label = await ctx.ui.select(
    `Set ${scope} default`,
    choices.map((choice) => choice.label),
  );
  if (label === undefined) return;
  const choice = choices.find((item) => item.label === label);
  if (!choice) throw new Error("Select an available default option.");
  store.setDefault(scope, choice.value);
}

function deletionMessage(
  entry: SessionCapabilityProfileEntry,
  catalog: CapabilityProfileCatalog,
): string {
  const references = (["global", "project"] as const).filter(
    (scope) => catalog.defaultValues[scope] === entry.id,
  );
  const fallback =
    entry.source === "project"
      ? catalog.entries.find((item) => item.source === "global" && item.id === entry.id)
      : undefined;
  return [
    `Delete ${entry.id} (${entry.source})?`,
    references.length
      ? `Known default references: ${references.join(", ")}. These references will not change.`
      : "No known default references.",
    ...(fallback
      ? [
          `Deletion will expose the global definition ${entry.id}${fallback.profile ? "." : ", which is invalid."}`,
        ]
      : []),
    "Current session exclusions and the applied snapshot will not change.",
  ].join("\n");
}

async function runScopedAction(
  action: CapabilityProfileAction,
  entry: SessionCapabilityProfileEntry,
  catalog: CapabilityProfileCatalog,
  options: ProfileActionOptions,
): Promise<void> {
  const { ctx, store, state, apply } = options;
  const { id, source } = entry;
  switch (action.value) {
    case "apply": {
      const profile = catalog.effectiveProfiles.find(
        (item) => item.id === id && item.source === source,
      );
      if (!profile || entry.shadowed)
        throw new Error(`Profile ${id} (${source}) is invalid or shadowed.`);
      apply(profile);
      return;
    }
    case "replace":
      if (
        await ctx.ui.confirm(
          "Replace saved profile?",
          `Replace ${id} (${source}) with current exclusions? The session will not change.`,
        )
      ) {
        requireEntry(store.read(), source, id);
        store.save(source, id, captureSessionCapabilityExclusions(state), true);
      }
      return;
    case "delete":
      if (await ctx.ui.confirm("Delete profile?", deletionMessage(entry, catalog)))
        store.delete(source, id);
      return;
    default:
      throw new Error(`Unknown profile action: ${action.value}.`);
  }
}

/**
 * Run dialogs after the selector closes. Read current configuration and trust for each action.
 * Throw read, validation, and write failures to the command loop. Writes do not apply profiles.
 */
export async function runCapabilityProfileAction(
  action: CapabilityProfileAction,
  options: ProfileActionOptions,
): Promise<void> {
  const catalog = options.store.read();
  if (action.id === "profile:save" && action.value === "save") {
    await saveCurrentAs(options);
    return;
  }
  const defaultScope =
    action.id === "profile:default:global"
      ? "global"
      : action.id === "profile:default:project"
        ? "project"
        : undefined;
  if (defaultScope && action.value === "set-default") {
    if (defaultScope === "project" && !options.ctx.isProjectTrusted()) {
      throw new Error("Project trust is required to change the project default.");
    }
    await setDefault(defaultScope, catalog, options);
    return;
  }
  const scope = action.id.startsWith("profile:global:")
    ? "global"
    : action.id.startsWith("profile:project:")
      ? "project"
      : undefined;
  if (!scope) throw new Error(`Unknown profile action: ${action.id}.`);
  const id = action.id.slice(`profile:${scope}:`.length);
  const entry = requireEntry(catalog, scope, id);
  await runScopedAction(action, entry, catalog, options);
}
