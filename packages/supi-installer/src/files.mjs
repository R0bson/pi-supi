import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read without creating files. Only absence means an empty document. @param {string} path */
export function readOptional(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw new Error(`Cannot read ${path}`, { cause: error });
  }
}

/** @param {string} path @param {Record<string, string | null>} files */
export function readObject(path, files) {
  const text = readOptional(path);
  files[path] = text;
  if (text === null) return {};
  try {
    const value = JSON.parse(text.replace(/^\uFEFF/, ""));
    if (!isRecord(value)) throw new Error("Expected a JSON object");
    return value;
  } catch (error) {
    throw new Error(`Invalid JSON object in ${path}`, { cause: error });
  }
}

/** Include raw text so external edits cannot silently reuse an old plan. @param {Record<string, string | null>} files */
export function fingerprint(files) {
  return createHash("sha256")
    .update(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))))
    .digest("hex");
}
