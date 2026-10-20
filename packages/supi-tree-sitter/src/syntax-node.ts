// Shared type alias for tree-sitter syntax nodes used in structure extraction.
// We use a minimal interface instead of importing from web-tree-sitter directly
// to avoid coupling to the runtime module.

export interface SyntaxNodeLike {
  type: string;
  text: string;
  children: SyntaxNodeLike[];
  parent: SyntaxNodeLike | null;
  /** True when this syntax node is an inserted recovery node. */
  isMissing?: boolean;
  /** True when this node contains a syntax error or inserted node. */
  hasError?: boolean;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  childForFieldName(name: string): SyntaxNodeLike | null;
  childrenForFieldName(name: string): SyntaxNodeLike[];
}
