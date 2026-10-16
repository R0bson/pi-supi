import { applyPreset, toggleCell } from "../matrix.mjs";

/** Ignore bracketed paste; only key input can edit or confirm a draft. @param {import('./view.mjs').View} view @param {import('node:readline').Key} key @param {{pasting: boolean, width: number, height: number}} input */
export function handleKey(view, key, input) {
  if (key.sequence === "\u001b[200~") {
    input.pasting = true;
    return "ignore";
  }
  if (key.sequence === "\u001b[201~") {
    input.pasting = false;
    return "ignore";
  }
  if (input.pasting) return "ignore";
  if (key.name === "escape" || (key.ctrl && key.name === "c")) return "cancel";
  if (input.width < 60 || input.height < 12) return "ignore";
  if (view.review) return editReview(view, key.name) ? "apply" : "draw";
  editMatrix(view, key.name);
  return "draw";
}

/** Set the alternate screen, cursor, and bracketed-paste modes. @param {NodeJS.WriteStream} output @param {boolean} enabled */
export function screenMode(output, enabled) {
  const prefix = "\u001b[?";
  output.write(`${prefix}1049${enabled ? "h" : "l"}`);
  output.write(`${prefix}25${enabled ? "l" : "h"}`);
  output.write(`${prefix}2004${enabled ? "h" : "l"}`);
}

/** @param {{input: NodeJS.ReadStream, output: NodeJS.WriteStream, wasRaw: boolean, wasFlowing: boolean | null}} state */
export function restoreTerminal({ input, output, wasRaw, wasFlowing }) {
  input.setRawMode(wasRaw);
  if (wasFlowing !== true) input.pause();
  if (!output.destroyed) screenMode(output, false);
}

/** @param {import('./view.mjs').View} view @param {string | undefined} name */
export function editMatrix(view, name) {
  switch (name) {
    case "up":
      view.index = Math.max(0, view.index - 1);
      break;
    case "down":
      view.index = Math.min(view.matrix.rows.length - 1, view.index + 1);
      break;
    case "left":
      view.scope = "project";
      break;
    case "right":
      view.scope = "global";
      break;
    case "space":
      toggleCell(view.matrix, view.index, view.scope);
      break;
    case "r":
      applyPreset(view.matrix, view.scope, "recommended");
      break;
    case "a":
      applyPreset(view.matrix, view.scope, "all");
      break;
    case "c":
      applyPreset(view.matrix, view.scope, "clear");
      break;
    case "return":
      view.review = true;
      view.offset = 0;
      break;
    default:
      break;
  }
}

/** @param {import('./view.mjs').View} view @param {string | undefined} name */
export function editReview(view, name) {
  switch (name) {
    case "y":
      return true;
    case "e":
      view.review = false;
      break;
    case "up":
      view.offset--;
      break;
    case "down":
      view.offset++;
      break;
    default:
      break;
  }
  return false;
}
