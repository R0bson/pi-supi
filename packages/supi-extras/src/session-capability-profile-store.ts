import { readFileSync } from "node:fs";
import { getSupiConfigPath, replaceSupiConfigSection } from "@mrclrchtr/supi-core/config";
import {
  isSessionCapabilityProfileId,
  resolveSessionCapabilityProfiles,
  type SessionCapabilityProfileDiagnostic,
  type SessionCapabilityProfileScope,
  type SessionCapabilityProfilesResolution,
  validateSessionCapabilityProfile,
} from "@mrclrchtr/supi-core/session";

const SECTION = "sessionCapabilities";

/** Config locations and the current project trust decision. */
export interface CapabilityProfileStoreOptions {
  cwd: string;
  /** Override the OS home directory for global configuration. */
  homeDir?: string;
  /** Get the current trust decision before project access. */
  isProjectTrusted: () => boolean;
}

/** Resolved profiles and the raw default values for scoped actions. */
export interface CapabilityProfileCatalog extends SessionCapabilityProfilesResolution {
  defaultValues: { global?: unknown; project?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read strictly so malformed JSON cannot be treated as an absent config file. */
function readSection(path: string): unknown {
  try {
    const config: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!isRecord(config)) throw new Error("Config root must be an object.");
    return config[SECTION];
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return undefined;
    throw new Error(
      `Cannot read config at ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function readCatalogSection(
  path: string,
  scope: SessionCapabilityProfileScope,
  errors: SessionCapabilityProfileDiagnostic[],
): unknown {
  try {
    return readSection(path);
  } catch (error) {
    errors.push({ scope, path, message: error instanceof Error ? error.message : String(error) });
    // A failed read is invalid, not absent. It must block default inheritance.
    return null;
  }
}

function readWritableSection(
  scope: SessionCapabilityProfileScope,
  options: CapabilityProfileStoreOptions,
): Record<string, unknown> {
  if (scope === "project" && !options.isProjectTrusted()) {
    throw new Error("Project trust is required to change capability profiles.");
  }
  const path = getSupiConfigPath(scope, options.cwd, options);
  const section = readSection(path);
  if (section === undefined) return {};
  if (!isRecord(section)) throw new Error(`sessionCapabilities must be an object: ${path}`);
  if (Object.hasOwn(section, "profiles") && !isRecord(section.profiles)) {
    throw new Error(`profiles must be an object: ${path}`);
  }
  return section;
}

/** Check section removal because the shared writer ignores file-removal errors. */
function writeSection(
  scope: SessionCapabilityProfileScope,
  section: Record<string, unknown>,
  options: CapabilityProfileStoreOptions,
): void {
  replaceSupiConfigSection({ section: SECTION, scope, cwd: options.cwd }, section, options);
  if (Object.keys(section).length === 0) {
    const path = getSupiConfigPath(scope, options.cwd, options);
    if (readSection(path) !== undefined) throw new Error(`Cannot remove ${SECTION} at ${path}.`);
  }
}

/**
 * Read and change scoped configuration without a cache or changes to session state.
 * Read errors become diagnostics. Mutation errors are thrown to the caller.
 */
export function createCapabilityProfileStore(options: CapabilityProfileStoreOptions) {
  const store = {
    /** Read current profiles and diagnostics. Ignore untrusted project configuration. */
    read(): CapabilityProfileCatalog {
      const projectTrusted = options.isProjectTrusted();
      const readErrors: SessionCapabilityProfileDiagnostic[] = [];
      const global = readCatalogSection(
        getSupiConfigPath("global", options.cwd, options),
        "global",
        readErrors,
      );
      const project = projectTrusted
        ? readCatalogSection(
            getSupiConfigPath("project", options.cwd, options),
            "project",
            readErrors,
          )
        : undefined;
      const resolution = resolveSessionCapabilityProfiles({ global, project, projectTrusted });
      return {
        ...resolution,
        errors: [
          ...readErrors,
          ...resolution.errors.filter(
            (error) => !readErrors.some((read) => read.scope === error.scope),
          ),
        ],
        defaultValues: {
          ...(isRecord(global) && Object.hasOwn(global, "defaultProfile")
            ? { global: global.defaultProfile }
            : {}),
          ...(isRecord(project) && Object.hasOwn(project, "defaultProfile")
            ? { project: project.defaultProfile }
            : {}),
        },
      };
    },
    /** Save exact exclusion sets. Replacement requires explicit approval from the caller. */
    save(
      scope: SessionCapabilityProfileScope,
      id: string,
      profile: unknown,
      replace = false,
    ): void {
      if (!isSessionCapabilityProfileId(id)) {
        throw new Error("Invalid profile ID: use lowercase words with single hyphens.");
      }
      const result = validateSessionCapabilityProfile(profile);
      if (!result.profile) throw new Error(result.errors.join(" "));
      const section = readWritableSection(scope, options);
      const profiles = isRecord(section.profiles) ? section.profiles : {};
      if (Object.hasOwn(profiles, id) && replace !== true) {
        throw new Error(`Profile ${id} already exists in ${scope}. Confirm replacement first.`);
      }
      section.profiles = { ...profiles, [id]: result.profile };
      writeSection(scope, section, options);
    },
    /** Delete one scoped definition. Leave all default references unchanged. */
    delete(scope: SessionCapabilityProfileScope, id: string): void {
      const section = readWritableSection(scope, options);
      if (!isRecord(section.profiles) || !Object.hasOwn(section.profiles, id)) return;
      delete section.profiles[id];
      if (Object.keys(section.profiles).length === 0) delete section.profiles;
      writeSection(scope, section, options);
    },
    /** Set a default ID, store null for none, or remove the key with undefined. */
    setDefault(scope: SessionCapabilityProfileScope, id: string | null | undefined): void {
      const section = readWritableSection(scope, options);
      if (
        id !== undefined &&
        id !== null &&
        !store.read().effectiveProfiles.some((profile) => profile.id === id)
      ) {
        throw new Error(`Default profile ${id} is missing or invalid.`);
      }
      if (id === undefined) delete section.defaultProfile;
      else section.defaultProfile = id;
      writeSection(scope, section, options);
    },
  };
  return store;
}
