import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";

const MAX_DISCLOSURE_CHARACTERS = 4096;
const MAX_COLLAPSED_ROWS = 3;
const MAX_EXPANDED_ROWS = 10;

/** Limit candidate disclosure text without changing the full saved provider reason. */
export class BoundedCandidateDisclosure implements Component {
  private readonly text: string;
  private readonly sourceLimited: boolean;

  constructor(
    text: string,
    private readonly expanded: boolean,
    private readonly theme: Theme,
  ) {
    const plain = stripVTControlCharacters(text)
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, " ")
      .replace(/[\p{Cc}\p{Bidi_Control}]/gu, (character) => (character === "\n" ? character : ""));
    this.text = plain.slice(0, MAX_DISCLOSURE_CHARACTERS);
    this.sourceLimited = plain.length > MAX_DISCLOSURE_CHARACTERS;
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const rows = new Text(this.theme.fg("muted", this.text), 0, 0).render(safeWidth);
    const maxRows = this.expanded ? MAX_EXPANDED_ROWS : MAX_COLLAPSED_ROWS;
    if (!this.sourceLimited && rows.length <= maxRows) return rows;
    const notice = this.expanded
      ? "Provider reason limited for display."
      : "Provider reason limited; expand for more.";
    return [
      ...rows.slice(0, maxRows),
      ...new Text(this.theme.fg("dim", notice), 0, 0).render(safeWidth),
    ];
  }

  /** Text and theme formatting are rebuilt for each render. */
  invalidate(): void {}
}
