import { renameMe, Surface } from "./model.js";

export class Widget extends Surface {
  render() {
    return String(renameMe(2));
  }
}

export const knownError = missingFunction();
