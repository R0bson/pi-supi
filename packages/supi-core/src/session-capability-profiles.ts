/** Exact names to exclude. Omitted configuration lists mean empty sets. */
export interface SessionCapabilityProfileDefinition {
  excludedTools?: string[];
  hiddenSkills?: string[];
}

/** Validated exclusion sets. Names need not match the current inventory. */
export interface SessionCapabilityProfile {
  excludedTools: string[];
  hiddenSkills: string[];
}

/** A profile is available only when validation has no errors. */
export interface SessionCapabilityProfileValidation {
  profile?: SessionCapabilityProfile;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names: unknown[] = [...new Set(value)];
  return names.every((name): name is string => typeof name === "string") ? names : undefined;
}

/** Validate and copy a complete definition. Do not check inventory or expand patterns. */
export function validateSessionCapabilityProfile(
  value: unknown,
): SessionCapabilityProfileValidation {
  if (!isRecord(value)) return { errors: ["Profile must be an object."] };
  const excludedTools = Object.hasOwn(value, "excludedTools") ? readNames(value.excludedTools) : [];
  const hiddenSkills = Object.hasOwn(value, "hiddenSkills") ? readNames(value.hiddenSkills) : [];
  const errors = Object.keys(value)
    .filter((key) => key !== "excludedTools" && key !== "hiddenSkills")
    .map((key) => `Unknown profile field: ${key}.`);
  if (!excludedTools) errors.push("excludedTools must be an array of strings.");
  if (!hiddenSkills) errors.push("hiddenSkills must be an array of strings.");
  if (errors.length || !excludedTools || !hiddenSkills) return { errors };
  return { profile: { excludedTools, hiddenSkills }, errors };
}

/** Configuration scope that supplied a profile or default. */
export type SessionCapabilityProfileScope = "global" | "project";

/** Configuration values for the sessionCapabilities section. */
export interface SessionCapabilityProfilesSection {
  profiles?: Record<string, SessionCapabilityProfileDefinition>;
  defaultProfile?: string | null;
}

/** Session-owned identity and original exclusion sets, independent of configuration. */
export interface SessionCapabilityProfileSnapshot extends SessionCapabilityProfile {
  id: string;
  source: SessionCapabilityProfileScope;
}

/** A configuration error with a scope and field path for display. */
export interface SessionCapabilityProfileDiagnostic {
  scope: SessionCapabilityProfileScope;
  path: string;
  message: string;
}

/** A scoped definition, including invalid definitions and hidden global definitions. */
export interface SessionCapabilityProfileEntry {
  id: string;
  source: SessionCapabilityProfileScope;
  shadowed: boolean;
  profile?: SessionCapabilityProfile;
  errors: SessionCapabilityProfileDiagnostic[];
}

/** Default selection source can differ from the effective profile source. */
export type SessionCapabilityProfileDefault =
  | { status: "none"; source?: SessionCapabilityProfileScope }
  | {
      status: "resolved";
      source: SessionCapabilityProfileScope;
      id: string;
      profile: SessionCapabilityProfileSnapshot;
    }
  | { status: "invalid"; source: SessionCapabilityProfileScope; id?: string };

/** Raw sections, not merged configuration. Callers must check trust before project reads. */
export interface ResolveSessionCapabilityProfilesOptions {
  global?: unknown;
  project?: unknown;
  projectTrusted: boolean;
}

/** Data for profile rows, scoped actions, and default warnings. No I/O is performed. */
export interface SessionCapabilityProfilesResolution {
  entries: SessionCapabilityProfileEntry[];
  effectiveProfiles: SessionCapabilityProfileSnapshot[];
  default: SessionCapabilityProfileDefault;
  errors: SessionCapabilityProfileDiagnostic[];
}

/** IDs contain lowercase ASCII words separated by single hyphens. */
export function isSessionCapabilityProfileId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z]+(?:-[a-z]+)*$/.test(value);
}

/** Validate and copy stored identity and original lists. Invalid metadata has no identity. */
export function decodeSessionCapabilityProfileSnapshot(
  value: unknown,
): SessionCapabilityProfileSnapshot | undefined {
  if (!isRecord(value) || !isSessionCapabilityProfileId(value.id)) return undefined;
  if (value.source !== "global" && value.source !== "project") return undefined;
  const { id, source, ...definition } = value;
  if (!Object.hasOwn(definition, "excludedTools") || !Object.hasOwn(definition, "hiddenSkills"))
    return undefined;
  const result = validateSessionCapabilityProfile(definition);
  return result.profile ? { id, source, ...result.profile } : undefined;
}

function readEntries(
  value: unknown,
  source: SessionCapabilityProfileScope,
): SessionCapabilityProfileEntry[] {
  if (!isRecord(value) || !isRecord(value.profiles)) return [];
  return Object.entries(value.profiles).map(([id, definition]) => {
    const result = validateSessionCapabilityProfile(definition);
    if (!isSessionCapabilityProfileId(id))
      result.errors.push("Invalid profile ID: use lowercase words with single hyphens.");
    return {
      id,
      source,
      shadowed: false,
      profile: result.errors.length ? undefined : result.profile,
      errors: result.errors.map((message) => ({ scope: source, path: `profiles.${id}`, message })),
    };
  });
}

type DefaultReference =
  | SessionCapabilityProfileDefault
  | { status: "pending"; source: SessionCapabilityProfileScope; id: string };

function readDefault(
  value: unknown,
  source: SessionCapabilityProfileScope,
  errors: SessionCapabilityProfileDiagnostic[],
): DefaultReference | undefined {
  if (!isRecord(value) || !Object.hasOwn(value, "defaultProfile")) return undefined;
  if (value.defaultProfile === null) return { status: "none", source };
  if (isSessionCapabilityProfileId(value.defaultProfile)) {
    return { status: "pending", source, id: value.defaultProfile };
  }
  errors.push({
    scope: source,
    path: "defaultProfile",
    message: "defaultProfile must be null or a valid profile ID.",
  });
  return { status: "invalid", source };
}

function resolveDefault(
  selected: DefaultReference | undefined,
  profiles: SessionCapabilityProfileSnapshot[],
  errors: SessionCapabilityProfileDiagnostic[],
): SessionCapabilityProfileDefault {
  if (!selected) return { status: "none" };
  if (selected.status !== "pending") return selected;
  const { source, id } = selected;
  const profile = profiles.find((entry) => entry.id === id);
  if (profile) return { status: "resolved", source, id, profile };
  errors.push({
    scope: source,
    path: "defaultProfile",
    message: `Default profile ${id} is missing or invalid. No profile will be applied.`,
  });
  return { status: "invalid", source, id };
}

interface ScopedProfiles {
  entries: SessionCapabilityProfileEntry[];
  errors: SessionCapabilityProfileDiagnostic[];
  default?: DefaultReference;
}

/** Reject malformed sections, but retain known IDs to prevent global fallback. */
function readSection(value: unknown, scope: SessionCapabilityProfileScope): ScopedProfiles {
  if (value === undefined) return { entries: [], errors: [] };
  if (!isRecord(value)) {
    return {
      entries: [],
      default: { status: "invalid", source: scope },
      errors: [
        { scope, path: "sessionCapabilities", message: "sessionCapabilities must be an object." },
      ],
    };
  }
  const sectionErrors = Object.keys(value)
    .filter((key) => key !== "profiles" && key !== "defaultProfile")
    .map((key) => ({ scope, path: key, message: `Unknown section field: ${key}.` }));
  if (Object.hasOwn(value, "profiles") && !isRecord(value.profiles)) {
    sectionErrors.push({ scope, path: "profiles", message: "profiles must be an object." });
  }
  const entries = readEntries(value, scope);
  const errors = [...sectionErrors, ...entries.flatMap((entry) => entry.errors)];
  const selection = readDefault(value, scope, errors);
  if (sectionErrors.length) {
    for (const entry of entries) {
      entry.profile = undefined;
      entry.errors.push(...sectionErrors);
    }
    return { entries, errors, default: { status: "invalid", source: scope } };
  }
  return { entries, errors, default: selection };
}

/**
 * Resolve whole profiles by ID. Ignore project data unless projectTrusted is true.
 * An absent section is undefined. Malformed sections cannot supply profiles or a default.
 */
export function resolveSessionCapabilityProfiles(
  options: ResolveSessionCapabilityProfilesOptions,
): SessionCapabilityProfilesResolution {
  const global = readSection(options.global, "global");
  const project = readSection(options.projectTrusted ? options.project : undefined, "project");
  const entries = [...global.entries, ...project.entries];
  const errors = [...global.errors, ...project.errors];
  const selected = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of entries) entry.shadowed = selected.get(entry.id) !== entry;
  const effectiveProfiles = [...selected.values()].flatMap((entry) =>
    entry.profile ? [{ id: entry.id, source: entry.source, ...entry.profile }] : [],
  );
  return {
    entries,
    effectiveProfiles,
    default: resolveDefault(project.default ?? global.default, effectiveProfiles, errors),
    errors,
  };
}
