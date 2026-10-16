import { isRecord } from "./files.mjs";
import { readInventory } from "./inventory.mjs";
import { npmName } from "./sources.mjs";

/** @typedef {import('./types.ts').Inventory} Inventory */
/** @typedef {import('./types.ts').Operation} Operation */

/** Ignore JSON formatting, but not object values or package order. @param {unknown} value */
function canonical(value) {
  return JSON.stringify(value, (_key, item) =>
    isRecord(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

/** @param {Inventory} inventory @param {Operation} operation */
function expectedEntries(inventory, operation) {
  const entries = inventory.entries[operation.scope];
  return operation.action === "install"
    ? [...entries, operation.source]
    : entries.filter(
        (entry) =>
          npmName(typeof entry === "string" ? entry : entry.source) !==
          `@mrclrchtr/${operation.name}`,
      );
}

/** A child may change its own declaration, not unrelated state. This detects observed edits, not an atomic filesystem transaction. @param {Inventory} before @param {Inventory} after @param {Operation} operation */
function isAllowedChange(before, after, operation) {
  const path = before.context.settingsPaths[operation.scope];
  const paths = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
  for (const file of paths) {
    if (file !== path && before.files[file] !== after.files[file]) return false;
  }
  const otherFields = /** @param {Inventory} inventory */ (inventory) => {
    const data = JSON.parse((inventory.files[path] ?? "{}").replace(/^\uFEFF/, ""));
    delete data.packages;
    return canonical(data);
  };
  if (otherFields(before) !== otherFields(after)) return false;
  const actual = canonical(after.entries[operation.scope]);
  return (
    actual === canonical(before.entries[operation.scope]) ||
    actual === canonical(expectedEntries(before, operation))
  );
}

/** Run one command and check that only its declaration changed. @param {Inventory} before @param {import('./types.ts').OperationResult} result @param {{runner: import('./types.ts').Runner, signal: AbortSignal, onProgress?: (operation: Operation) => void}} options */
async function attemptOperation(before, result, options) {
  const operation = result.operation;
  options.onProgress?.(operation);
  const args = [
    operation.action,
    operation.source,
    ...(operation.scope === "project" ? ["--local"] : []),
  ];
  let outcome;
  try {
    outcome = await options.runner(args, { cwd: before.context.project, signal: options.signal });
  } catch (error) {
    outcome = { code: 1, output: error instanceof Error ? error.message : String(error) };
  }
  result.output = outcome.output;
  result.status = outcome.code === 0 ? "success" : "failed";
  const after = readInventory(before.context);
  if (!isAllowedChange(before, after, operation))
    throw new Error(
      "Settings changed outside the selected operation. Remaining commands were not started; review a new plan.",
    );
  if (
    outcome.code === 0 &&
    canonical(after.entries[operation.scope]) !== canonical(expectedEntries(before, operation))
  ) {
    result.status = "failed";
    result.output += "\nPI reported success, but the expected declaration change was not found.";
  }
  return after;
}

/** Execute a confirmed plan. Failures do not guard scope moves or roll back successful changes. @param {Inventory} initial @param {Operation[]} operations @param {{runner: import('./types.ts').Runner, signal?: AbortSignal, onProgress?: (operation: Operation) => void}} options @returns {Promise<import('./types.ts').ExecutionReport>} */
export async function executePlan(initial, operations, options) {
  const signal = options.signal ?? new AbortController().signal;
  const results = operations.map((operation) => ({
    operation,
    status: /** @type {'success' | 'failed' | 'unattempted'} */ ("unattempted"),
    output: "",
  }));
  /** @type {import('./types.ts').ExecutionReport} */
  const report = { results, ok: true, cancelled: false };
  let expected = initial;
  try {
    for (const result of results) {
      if (signal.aborted) break;
      const before = readInventory(initial.context);
      if (before.fingerprint !== expected.fingerprint)
        throw new Error(
          "Settings or trust changed after review. Open the installer and review a new plan.",
        );
      expected = await attemptOperation(before, result, { ...options, signal });
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }
  report.cancelled = signal.aborted;
  try {
    report.inventory = readInventory(initial.context);
  } catch (error) {
    delete report.inventory;
    report.error = error instanceof Error ? error.message : String(error);
  }
  report.ok =
    !report.error && !report.cancelled && results.every((result) => result.status === "success");
  return report;
}
