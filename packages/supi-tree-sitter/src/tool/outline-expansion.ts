// Declaration wrapper handling for nested outline expansion.

import { nodeToRange } from "../coordinates.ts";
import type { SyntaxNodeLike } from "../syntax-node.ts";
import type { GrammarId, OutlineItem } from "../types.ts";
import { expandNestedItems } from "./outline-nested.ts";

/** Node types that can be extracted directly as outline items. */
export const OUTLINE_DECLARATION_NODE_TYPES = new Set([
  "function_declaration",
  "generator_function_declaration",
  "class_declaration",
  "abstract_class_declaration",
  "class",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "method_definition",
  "public_field_definition",
  "variable_declarator",
  "lexical_declaration",
  "ambient_declaration",
  "internal_module",
  "module",
  "function_signature",
]);

/** Expand extracted declarations using the syntax node that owns their scope. */
export function expandExtractedItems(options: {
  readonly items: OutlineItem[];
  readonly node: SyntaxNodeLike;
  readonly source: string;
  readonly lineStarts: readonly number[];
  readonly grammarId?: GrammarId;
  readonly extractItemsForNode: (node: SyntaxNodeLike) => OutlineItem[] | null;
}): OutlineItem[] {
  const { items, node, source } = options;
  if (node.type === "export_statement" || node.type === "ambient_declaration") {
    const declaration = node.children.find((child) =>
      OUTLINE_DECLARATION_NODE_TYPES.has(child.type),
    );
    if (declaration) return expandExtractedItems({ ...options, node: declaration });

    if (node.type === "export_statement") {
      const expression = node.children.find((child) =>
        [
          "arrow_function",
          "function_expression",
          "generator_function",
          "class_expression",
        ].includes(child.type),
      );
      if (expression) return expandExtractedItems({ ...options, node: expression });
    }
  }

  if (node.type === "lexical_declaration") {
    const declarators = node.children.filter((child) => child.type === "variable_declarator");
    if (declarators.length > 0) {
      return declarators.flatMap((declarator) => {
        const range = nodeToRange(declarator, source);
        const declarationItems = items.filter((item) => sameRange(item.range, range));
        return expandExtractedItems({ ...options, items: declarationItems, node: declarator });
      });
    }
  }

  return expandNestedItems(options);
}

function sameRange(left: OutlineItem["range"], right: OutlineItem["range"]): boolean {
  return (
    left.startLine === right.startLine &&
    left.startCharacter === right.startCharacter &&
    left.endLine === right.endLine &&
    left.endCharacter === right.endCharacter
  );
}
