import stringWidth from "string-width";
import { cleanLine, formatReview } from "../format.mjs";
import { getPlan } from "../matrix.mjs";
import { sourceOf } from "../sources.mjs";

/** @typedef {{matrix: import('../matrix.mjs').Matrix, index: number, scope: import('../types.ts').Scope, review: boolean, offset: number}} View */

/** Clip by terminal cells, not UTF-16 units. @param {string} line @param {number} width */
function clipLine(line, width) {
  let result = "";
  let size = 0;
  for (const char of cleanLine(line)) {
    size += stringWidth(char);
    if (size > width) break;
    result += char;
  }
  return result;
}

/** Keep every source character available in the scrollable review. @param {string} line @param {number} width */
function wrapLine(line, width) {
  const lines = [];
  let part = "";
  let size = 0;
  for (const char of cleanLine(line)) {
    const cells = stringWidth(char);
    if (size + cells > width) {
      lines.push(part);
      part = "";
      size = 0;
    }
    part += char;
    size += cells;
  }
  return [...lines, part];
}

/** @param {View} view @param {number} index @param {import('../types.ts').Scope} scope */
function cell(view, index, scope) {
  const row = view.matrix.rows[index];
  const locked =
    view.matrix.inventory.blocked[scope].length > 0 || (row.item.obsolete && !row.initial[scope]);
  const value = row.selected[scope] ? "x" : " ";
  return `${view.index === index && view.scope === scope ? ">" : " "}${locked ? `(${value})` : `[${value}]`}`;
}

/** @param {View} view @param {number} height */
function matrixLines(view, height) {
  const { matrix, index, scope } = view;
  const { context, blocked, unmanaged } = matrix.inventory;
  const count = Math.max(1, height - 10);
  const start = Math.max(0, Math.min(index - Math.floor(count / 2), matrix.rows.length - count));
  const row = matrix.rows[index];
  const source = row.initial[scope];
  const status = blocked[scope].length
    ? `BLOCKED ${scope}: ${blocked[scope][0]}`
    : source
      ? sourceOf(source)
      : scope === "project" && row.selected.global
        ? "No project declaration; available from global."
        : "No direct declaration.";
  return [
    "SuPi installer | checked = direct declaration",
    `Project: ${context.project}${context.project === context.home ? " [HOME WARNING]" : ""}`,
    `Global: ${context.settingsPaths.global}`,
    `${"Package".padEnd(31)}Project   Global`,
    ...matrix.rows.slice(start, start + count).map((item, offset) => {
      const position = start + offset;
      return `${position === index ? ">" : " "} ${item.item.name.padEnd(29)}${cell(view, position, "project").padEnd(10)}${cell(view, position, "global")}`;
    }),
    `${index + 1}/${matrix.rows.length} | Focus: ${scope} | Unmanaged: ${unmanaged.project.length + unmanaged.global.length}`,
    `${row.item.description} [${row.item.labels.join(", ")}]`,
    `${status}${typeof source === "object" ? " [filtered]" : ""}`,
    "Up/Down: row  Left/Right: scope  Space: toggle",
    "r: Recommended  a: All  c: Clear (focused column)",
    "Enter: review sources and changes  Esc: cancel",
  ];
}

/** Render a bounded frame. Review content scrolls separately from the matrix. @param {View} view @param {{width: number, height: number}} size */
export function renderView(view, { width, height }) {
  let lines;
  if (width < 60 || height < 12)
    lines = ["Resize terminal to at least 60 columns and 12 rows.", "Esc: cancel"];
  else if (view.review) {
    const operations = getPlan(view.matrix);
    const content = formatReview(view.matrix, operations).flatMap((line) =>
      wrapLine(line, width - 1),
    );
    const count = height - 5;
    view.offset = Math.max(0, Math.min(view.offset, Math.max(0, content.length - count)));
    lines = [
      "Review | failed installs do not block removals",
      "A failed move can leave neither declaration. No rollback.",
      `${operations.length} changes | lines ${view.offset + 1}-${Math.min(content.length, view.offset + count)}/${content.length}`,
      ...content.slice(view.offset, view.offset + count),
      "",
      "y: Apply  e: Edit  Up/Down: scroll  Esc: cancel",
    ];
  } else lines = matrixLines(view, height);
  return lines
    .slice(0, height)
    .map((line) => clipLine(line, Math.max(1, width - 1)))
    .join("\r\n");
}
