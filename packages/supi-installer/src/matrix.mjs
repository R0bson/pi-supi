import { catalog } from "./catalog.mjs";
import { npmName, sourceOf } from "./sources.mjs";

/** @typedef {{ inventory: import('./types.ts').Inventory, rows: import('./types.ts').MatrixRow[] }} Matrix */
/** @typedef {import('./types.ts').Scope} Scope */

/** Initialize from declarations, never from a preset. @param {import('./types.ts').Inventory} inventory @returns {Matrix} */
export function createMatrix(inventory) {
  const rows = catalog.map((item) => {
    const find = /** @param {Scope} scope */ (scope) =>
      inventory.entries[scope].find(
        (entry) => npmName(sourceOf(entry)) === `@mrclrchtr/${item.name}`,
      );
    const initial = { project: find("project"), global: find("global") };
    return {
      item,
      initial,
      selected: { project: Boolean(initial.project), global: Boolean(initial.global) },
    };
  });
  return {
    inventory,
    rows: rows.filter((row) => !row.item.obsolete || row.initial.project || row.initial.global),
  };
}

/** @param {Matrix} matrix @param {number} index @param {Scope} scope */
export function canEdit(matrix, index, scope) {
  const row = matrix.rows[index];
  return Boolean(
    row &&
      matrix.inventory.blocked[scope].length === 0 &&
      (!row.item.obsolete || row.initial[scope]),
  );
}

/** Removal-only rows permit undo but not new declarations. @param {Matrix} matrix @param {number} index @param {Scope} scope */
export function toggleCell(matrix, index, scope) {
  if (!canEdit(matrix, index, scope)) return false;
  const row = matrix.rows[index];
  row.selected[scope] = !row.selected[scope];
  return true;
}

/** Replace only the focused scope's draft. @param {Matrix} matrix @param {Scope} scope @param {'recommended' | 'all' | 'clear'} preset */
export function applyPreset(matrix, scope, preset) {
  for (const [index, row] of matrix.rows.entries()) {
    if (canEdit(matrix, index, scope))
      row.selected[scope] =
        !row.item.obsolete &&
        (preset === "all" || (preset === "recommended" && row.item.recommended));
  }
}

/** Create a plan with additions before removals, without scope-move guards. @param {Matrix} matrix @returns {import('./types.ts').Operation[]} */
export function getPlan(matrix) {
  /** @type {import('./types.ts').Operation[]} */
  const operations = [];
  for (const [index, row] of matrix.rows.entries()) {
    for (const scope of /** @type {const} */ (["project", "global"])) {
      const entry = row.initial[scope];
      if (!canEdit(matrix, index, scope) || row.selected[scope] === Boolean(entry)) continue;
      operations.push({
        action: row.selected[scope] ? "install" : "remove",
        scope,
        name: row.item.name,
        source: entry ? sourceOf(entry) : `npm:@mrclrchtr/${row.item.name}`,
      });
    }
  }
  return [
    ...operations.filter((op) => op.action === "install"),
    ...operations.filter((op) => op.action === "remove"),
  ];
}
