/**
 * Substrate context gathering for symbol-centered Orientation.
 *
 * Best-effort tree-sitter node/outline/imports/exports context plus LSP
 * hover/definition at one target position. Consumed by the Orientation
 * evidence collector in `collect.ts`.
 */

import {
  type CodeRequestControl,
  isCodeRequestInterruption,
  type SemanticProvider,
  type SourceRange,
  type StructuralProvider,
} from "@mrclrchtr/supi-code-runtime/api";

/** Structural provider subset plus optional semantic hover/definition used for gathering. */
export type ContextGatherProvider = Pick<
  StructuralProvider,
  "nodeAt" | "outline" | "imports" | "exports"
> &
  Partial<Pick<SemanticProvider, "hover" | "definition">>;

/**
 * Best-effort substrate evidence at one target position. `null` fields mean
 * the evidence was unavailable, not that the position is invalid.
 */
export interface SubstrateContext {
  nodeInfo: {
    type: string;
    text: string;
    startLine: number;
    startCharacter: number;
    ancestry: Array<{
      type: string;
      startLine: number;
      startCharacter: number;
      endLine: number;
      endCharacter: number;
    }>;
  } | null;
  outline: Array<{ name: string; kind: string; startLine: number; endLine: number }>;
  imports: Array<{ moduleSpecifier: string }>;
  exports: Array<{ name: string; kind: string }>;
  /** Best-effort LSP hover info at the anchored position. `null` when unavailable. */
  hover: { contents: string; range?: SourceRange } | null;
  /** Best-effort LSP definition targets at the anchored position. `null` when unavailable. */
  definition: Array<{ uri: string; range: SourceRange }> | null;
  /** Structural recovery from independently queried source operations. */
  recovery: Array<{
    operation: "nodeAt" | "outline" | "imports" | "exports";
    file: string;
    reason: string;
    errorRanges: readonly SourceRange[];
  }>;
}

/**
 * Gather best-effort substrate context at one target position.
 *
 * `line`/`character` are 1-based display coordinates; LSP hover/definition
 * queries convert to 0-based internally. Position-strict operations
 * (tree-sitter `nodeAt`, hover-at) run only when `positionStrict` is true —
 * callers holding a declaration-anchor target must pass false (ADR 0003).
 * File-level evidence (outline, imports, exports) and position-tolerant
 * definition lookups run regardless. Failures degrade to `null`/empty.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: best-effort substrate gathering with independent try/catch blocks kept together for readability
// biome-ignore lint/complexity/useMaxParams: one internal gather call site carries the full position context
export async function gatherSubstrateContext(
  provider: ContextGatherProvider | null,
  relPath: string,
  line: number,
  character: number,
  positionStrict: boolean,
  requestControl?: CodeRequestControl,
): Promise<SubstrateContext> {
  let nodeInfo: SubstrateContext["nodeInfo"] = null;
  let outline: SubstrateContext["outline"] = [];
  let imports: SubstrateContext["imports"] = [];
  let exports: SubstrateContext["exports"] = [];
  let hover: SubstrateContext["hover"] = null;
  let definition: SubstrateContext["definition"] = null;
  const recovery: SubstrateContext["recovery"] = [];

  if (!provider) return { nodeInfo, outline, imports, exports, hover, definition: null, recovery };

  try {
    if (positionStrict) {
      const nodeResult = await provider.nodeAt(relPath, line, character, requestControl);
      if (nodeResult.kind === "partial") {
        recovery.push({
          operation: "nodeAt",
          file: nodeResult.file,
          reason: nodeResult.reason,
          errorRanges: nodeResult.errorRanges,
        });
      }
      if (nodeResult.kind === "success" || nodeResult.kind === "partial") {
        nodeInfo = {
          type: nodeResult.data.type,
          text: nodeResult.data.text,
          startLine: nodeResult.data.startLine,
          startCharacter: nodeResult.data.startCharacter,
          ancestry: nodeResult.data.ancestry ?? [],
        };
      }
    }

    const outlineResult = await provider.outline(relPath, requestControl);
    if (outlineResult.kind === "partial") {
      recovery.push({
        operation: "outline",
        file: outlineResult.file,
        reason: outlineResult.reason,
        errorRanges: outlineResult.errorRanges,
      });
    }
    if (outlineResult.kind === "success" || outlineResult.kind === "partial") {
      outline = outlineResult.data.map((item) => ({
        name: item.name,
        kind: item.kind,
        startLine: item.startLine,
        endLine: item.endLine,
      }));
    }

    const importsResult = await provider.imports(relPath, requestControl);
    if (importsResult.kind === "partial") {
      recovery.push({
        operation: "imports",
        file: importsResult.file,
        reason: importsResult.reason,
        errorRanges: importsResult.errorRanges,
      });
    }
    if (importsResult.kind === "success" || importsResult.kind === "partial") {
      imports = importsResult.data;
    }

    const exportsResult = await provider.exports(relPath, requestControl);
    if (exportsResult.kind === "partial") {
      recovery.push({
        operation: "exports",
        file: exportsResult.file,
        reason: exportsResult.reason,
        errorRanges: exportsResult.errorRanges,
      });
    }
    if (exportsResult.kind === "success" || exportsResult.kind === "partial") {
      exports = exportsResult.data.map((item) => ({
        name: item.name,
        kind: item.kind,
      }));
    }

    // Best-effort hover — LSP expects 0-based coordinates; hover-at is position-strict.
    if (positionStrict && provider.hover) {
      try {
        const hoverResult = await provider.hover(relPath, {
          line: line - 1,
          character: character - 1,
        });
        if (hoverResult.kind !== "unavailable" && hoverResult.data) hover = hoverResult.data;
      } catch (error) {
        if (isCodeRequestInterruption(error, requestControl)) throw error;
        // hover failed — continue without it
      }
    }

    // Best-effort definition — LSP expects 0-based coordinates; definitions are position-tolerant.
    if (provider.definition) {
      try {
        const defResult = await provider.definition(relPath, {
          line: line - 1,
          character: character - 1,
        });
        if (defResult.kind !== "unavailable" && defResult.data.length > 0) {
          definition = defResult.data.map((loc) => ({
            uri: loc.uri,
            range: loc.range,
          }));
        }
      } catch (error) {
        if (isCodeRequestInterruption(error, requestControl)) throw error;
        // definition failed — continue without it
      }
    }
  } catch (error) {
    if (isCodeRequestInterruption(error, requestControl)) throw error;
    // Provider not available
  }

  return { nodeInfo, outline, imports, exports, hover, definition, recovery };
}
