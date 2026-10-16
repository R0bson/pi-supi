import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { catalog } from "./catalog.mjs";
import { readObject, readOptional } from "./files.mjs";
import { expandPath } from "./paths.mjs";

/** @param {import('./types.ts').PackageEntry} entry */
export function sourceOf(entry) {
  return typeof entry === "string" ? entry : entry.source;
}

/** Pins do not change the npm package identity. @param {string} source */
export function npmName(source) {
  if (!source.startsWith("npm:")) return undefined;
  return /^(@[^/\s]+\/[^@\s]+|[^@\s]+)(?:@.+)?$/.exec(source.slice(4).trim())?.[1];
}

/** @param {string} source */
function isRootGit(source) {
  if (!/^(git:|github:|https?:|ssh:|git@)/.test(source)) return false;
  const normalized = source
    .replace(/^(git:(?!\/\/)|github:)/, "")
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^git@/, "")
    .replace(/^github\.com:/, "github.com/");
  return /^(?:github\.com\/)?mrclrchtr\/supi(?:\.git)?\/?(?:[@#][^\s]+)?$/i.test(normalized);
}

/** Inspect local manifests as data, never as executable modules. @param {string} source @param {string} base @param {import('./types.ts').Inventory} inventory */
function localPackageName(source, base, inventory) {
  let path = resolve(base, expandPath(source, inventory.context.home));
  try {
    if (!statSync(path).isDirectory()) path = dirname(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  while (true) {
    const manifest = join(path, "package.json");
    const text = readOptional(manifest);
    inventory.files[manifest] = text;
    if (text !== null) return readObject(manifest, inventory.files).name;
    if (dirname(path) === path) return undefined;
    path = dirname(path);
  }
}

const managedNames = new Set(catalog.map((item) => `@mrclrchtr/${item.name}`));

/** @param {unknown} name */
function isSuPiName(name) {
  return (
    typeof name === "string" &&
    (managedNames.has(name) || name === "@mrclrchtr/supi" || name === "@mrclrchtr/supi-workspace")
  );
}

/** @param {string} source @param {import('./types.ts').Scope} scope @param {import('./types.ts').Inventory} inventory */
function isBlocked(source, scope, inventory) {
  const name = npmName(source);
  if (name === "@mrclrchtr/supi" || name === "@mrclrchtr/supi-workspace" || isRootGit(source))
    return true;
  if (/^(npm:|git:|github:|https?:|ssh:|git@|builtin:)/.test(source)) return false;
  return isSuPiName(
    localPackageName(source, dirname(inventory.context.settingsPaths[scope]), inventory),
  );
}

/** Classify sources without changing declarations. @param {import('./types.ts').Inventory} inventory */
export function classifySources(inventory) {
  for (const scope of /** @type {const} */ (["project", "global"])) {
    const seen = new Set();
    for (const entry of inventory.entries[scope]) {
      const source = sourceOf(entry);
      const name = npmName(source);
      if (name && managedNames.has(name)) {
        if (seen.has(name))
          throw new Error(
            `Duplicate managed package ${name} in ${inventory.context.settingsPaths[scope]}`,
          );
        seen.add(name);
        continue;
      }
      if (isBlocked(source, scope, inventory)) inventory.blocked[scope].push(source);
      else inventory.unmanaged[scope].push(source);
    }
  }
}
