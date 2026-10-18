/** Grammar-aware tokenizer and parser for supported go.mod and go.work directives. */

/** One parsed directive entry. Block entries repeat the block directive name. */
export interface GoDirective {
  readonly name: string;
  readonly args: readonly string[];
  readonly line: number;
  readonly block: boolean;
}

/** A tokenizer or grammar limitation with its 1-based source line. */
export interface GoParseIssue {
  readonly line: number;
  readonly reason: string;
}

/** Parsed directives and syntax issues; one malformed line does not discard earlier lines. */
export interface GoParseResult {
  readonly directives: readonly GoDirective[];
  readonly issues: readonly GoParseIssue[];
}

type TokenKind = "word" | "newline" | "lparen" | "rparen" | "arrow" | "punct";

interface GoToken {
  readonly kind: TokenKind;
  readonly value: string;
  readonly line: number;
}

interface TokenizeResult {
  readonly tokens: readonly GoToken[];
  readonly issues: readonly GoParseIssue[];
}

interface TokenizerState {
  readonly tokens: GoToken[];
  readonly issues: GoParseIssue[];
  index: number;
  line: number;
  readonly text: string;
}

/** Parse go.mod or go.work text into directive entries without assigning project roles. */
export function parseGoFile(text: string): GoParseResult {
  const tokenized = tokenizeGoFile(text);
  return parseGoTokens(tokenized.tokens, tokenized.issues);
}

function tokenizeGoFile(text: string): TokenizeResult {
  const state: TokenizerState = { text, tokens: [], issues: [], index: 0, line: 1 };
  while (state.index < text.length) {
    if (!consumeNext(state)) break;
  }
  return { tokens: state.tokens, issues: state.issues };
}

function consumeNext(state: TokenizerState): boolean {
  const character = state.text[state.index] ?? "";
  if (character === "\n") {
    pushNewline(state);
    return true;
  }
  if (/\s/.test(character)) {
    state.index++;
    return true;
  }
  if (startsComment(state, "//")) {
    skipLineComment(state);
    return true;
  }
  if (startsComment(state, "/*")) return skipBlockComment(state);
  if (character === '"' || character === "`") return consumeQuoted(state);
  return consumePunctuationOrWord(state);
}

function pushNewline(state: TokenizerState): void {
  state.tokens.push({ kind: "newline", value: "\n", line: state.line });
  state.line++;
  state.index++;
}

function startsComment(state: TokenizerState, prefix: string): boolean {
  return state.text.slice(state.index, state.index + prefix.length) === prefix;
}

function skipLineComment(state: TokenizerState): void {
  state.index += 2;
  while (state.index < state.text.length && state.text[state.index] !== "\n") state.index++;
}

function skipBlockComment(state: TokenizerState): boolean {
  const end = state.text.indexOf("*/", state.index + 2);
  if (end < 0) {
    state.issues.push({ line: state.line, reason: "Unterminated block comment." });
    return false;
  }
  state.line += countNewlines(state.text.slice(state.index + 2, end));
  state.index = end + 2;
  return true;
}

function consumeQuoted(state: TokenizerState): boolean {
  const quoted = readQuoted(state.text, state.index, state.line, state.issues);
  if (!quoted) return false;
  state.tokens.push({ kind: "word", value: quoted.value, line: state.line });
  state.line += quoted.newlines;
  state.index = quoted.end;
  return true;
}

function consumePunctuationOrWord(state: TokenizerState): boolean {
  const punctuation = readPunctuation(state.text, state.index);
  if (punctuation) {
    state.tokens.push({ kind: punctuation.kind, value: punctuation.value, line: state.line });
    state.index += punctuation.value.length;
    return true;
  }
  const start = state.index;
  while (
    state.index < state.text.length &&
    !isWordBoundary(state.text[state.index] ?? "") &&
    !startsComment(state, "//") &&
    !startsComment(state, "/*")
  ) {
    state.index++;
  }
  if (state.index === start) return false;
  state.tokens.push({
    kind: "word",
    value: state.text.slice(start, state.index),
    line: state.line,
  });
  return true;
}

function readQuoted(
  text: string,
  start: number,
  line: number,
  issues: GoParseIssue[],
): { value: string; end: number; newlines: number } | null {
  const quote = text[start];
  let value = "";
  let index = start + 1;
  let newlines = 0;
  while (index < text.length) {
    const character = text[index] ?? "";
    if (character === quote) return { value, end: index + 1, newlines };
    if (character === "\n") newlines++;
    if (quote === '"' && character === "\\") {
      const escaped = readEscape(text, index);
      if (!escaped) {
        issues.push({
          line,
          reason: "Unsupported quoted-string escape; the value is not interpreted.",
        });
        return null;
      }
      value += escaped.value;
      index = escaped.next;
      continue;
    }
    value += character;
    index++;
  }
  issues.push({ line, reason: "Unterminated quoted string." });
  return null;
}

function readEscape(text: string, index: number): { value: string; next: number } | null {
  const values: Record<string, string> = {
    a: "\u0007",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
    '"': '"',
    "\\": "\\",
  };
  const value = values[text[index + 1] ?? ""];
  return value === undefined ? null : { value, next: index + 2 };
}

function readPunctuation(text: string, index: number): { kind: TokenKind; value: string } | null {
  const character = text[index] ?? "";
  if (character === "=" && text[index + 1] === ">") return { kind: "arrow", value: "=>" };
  if (character === "(") return { kind: "lparen", value: "(" };
  if (character === ")") return { kind: "rparen", value: ")" };
  if (character === "=") return { kind: "punct", value: "=" };
  if (character === "[" || character === "]" || character === ",") {
    return { kind: "punct", value: character };
  }
  return null;
}

function isWordBoundary(character: string): boolean {
  return /\s/.test(character) || character === "(" || character === ")" || character === "=";
}

function countNewlines(value: string): number {
  let count = 0;
  for (const character of value) {
    if (character === "\n") count++;
  }
  return count;
}

interface Cursor {
  index: number;
  readonly tokens: readonly GoToken[];
  readonly issues: GoParseIssue[];
}

function parseGoTokens(
  tokens: readonly GoToken[],
  initialIssues: readonly GoParseIssue[],
): GoParseResult {
  const cursor: Cursor = { index: 0, tokens, issues: [...initialIssues] };
  const directives: GoDirective[] = [];
  while (true) {
    skipNewlines(cursor);
    const head = cursor.tokens[cursor.index];
    if (!head) break;
    if (head.kind !== "word") {
      malformed(cursor, head, "Expected a directive name.");
      skipLine(cursor);
      continue;
    }
    cursor.index++;
    appendDirective(cursor, head, directives);
  }
  return { directives, issues: cursor.issues };
}

function appendDirective(cursor: Cursor, head: GoToken, directives: GoDirective[]): void {
  const first = cursor.tokens[cursor.index];
  if (first?.kind === "lparen" && first.line === head.line) {
    cursor.index++;
    parseBlock(cursor, head, directives);
    return;
  }
  const lineEnd = nextLineEnd(cursor.tokens, cursor.index);
  const args = tokensUntilLineEnd(cursor.tokens, cursor.index, lineEnd);
  directives.push({
    name: head.value,
    args: args.map((token) => token.value),
    line: head.line,
    block: false,
  });
  cursor.index = lineEnd;
}

function parseBlock(cursor: Cursor, head: GoToken, directives: GoDirective[]): void {
  while (true) {
    skipNewlines(cursor);
    const token = cursor.tokens[cursor.index];
    if (!token) {
      malformed(cursor, head, `Unterminated ${head.value} block.`);
      return;
    }
    if (finishBlock(cursor, head, token)) return;
    appendBlockEntry(cursor, head, token, directives);
  }
}

function finishBlock(cursor: Cursor, head: GoToken, token: GoToken): boolean {
  if (token.kind !== "rparen") return false;
  cursor.index++;
  const after = cursor.tokens[cursor.index];
  if (after && after.kind !== "newline") {
    malformed(cursor, after, `Unexpected token after ${head.value} block.`);
    skipLine(cursor);
  }
  return true;
}

function appendBlockEntry(
  cursor: Cursor,
  head: GoToken,
  token: GoToken,
  directives: GoDirective[],
): void {
  const lineEnd = nextLineEnd(cursor.tokens, cursor.index);
  const closeIndex = findClosingParen(cursor.tokens, cursor.index, lineEnd);
  const entryEnd = closeIndex ?? lineEnd;
  const args = tokensUntilLineEnd(cursor.tokens, cursor.index, entryEnd);
  if (args.some((entry) => entry.kind === "lparen" || entry.kind === "rparen")) {
    malformed(cursor, args[0] ?? token, `Nested parentheses are not supported in ${head.value}.`);
  } else if (args.length > 0) {
    directives.push({
      name: head.value,
      args: args.map((entry) => entry.value),
      line: token.line,
      block: true,
    });
  }
  cursor.index = entryEnd;
}

function findClosingParen(tokens: readonly GoToken[], start: number, end: number): number | null {
  for (let index = start; index < end; index++) {
    if (tokens[index]?.kind === "rparen") return index;
  }
  return null;
}

function tokensUntilLineEnd(tokens: readonly GoToken[], start: number, end: number): GoToken[] {
  return tokens.slice(start, end).filter((token) => token.kind !== "newline");
}

function nextLineEnd(tokens: readonly GoToken[], start: number): number {
  let index = start;
  while (index < tokens.length && tokens[index]?.kind !== "newline") index++;
  return index;
}

function skipNewlines(cursor: Cursor): void {
  while (cursor.tokens[cursor.index]?.kind === "newline") cursor.index++;
}

function skipLine(cursor: Cursor): void {
  cursor.index = nextLineEnd(cursor.tokens, cursor.index);
}

function malformed(cursor: Cursor, token: GoToken, reason: string): void {
  cursor.issues.push({ line: token.line, reason });
}
