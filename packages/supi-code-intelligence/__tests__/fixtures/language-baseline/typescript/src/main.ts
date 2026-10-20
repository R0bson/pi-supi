import type { Surface } from "./model";
import { renameMe } from "./model";

export class Widget implements Surface {
  render(): string {
    function nestedCall(): number {
      return renameMe(3);
    }
    return String(renameMe(2) + nestedCall() + renameMe(4));
  }
}

export const knownError: number = "wrong";
