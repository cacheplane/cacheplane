// SPDX-License-Identifier: MIT
//
// @cacheplane/partial-markdown — type definitions
//
// Two layers:
//   1. Pull-style internal state machine: AstNode + StreamState + InternalState.
//      Mirrors the partial-json approach (flat array, numeric ids).
//   2. Push-style public API: MarkdownNode + ParseEvent + PartialMarkdownParser.
//      Tree-shaped, identity-preserving, mutated in place.
//
// The push-style layer wraps the pull-style state machine; the two share the
// same node graph internally but expose different surfaces.

// ────────────────────────────────────────────────────────────────────────────
// Status tristate (shared)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parsing / streaming state of a node. Tristate, pinned by types.test.ts.
 * Must match the StreamStatus declaration in @cacheplane/partial-json.
 */
export type StreamStatus = 'pending' | 'streaming' | 'complete';

export type Alignment = 'left' | 'center' | 'right' | null;
export type HtmlBlockKind = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface PartialMarkdownParserOptions {
  math?: {
    /** Recognize $..$ and $$..$$. Default: true. */
    dollar?: boolean;
    /** Recognize \(..\) and \[..\]. Default: true. */
    bracket?: boolean;
  };
}

export interface ResolvedParserOptions {
  math: {
    dollar: boolean;
    bracket: boolean;
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Pull-style internal state machine
// ────────────────────────────────────────────────────────────────────────────

export type ParseMode =
  | 'block'
  | 'paragraph'
  | 'heading'
  | 'blockquote'
  | 'list-item'
  | 'code-fence'
  | 'code-indented'
  | 'inline'
  | 'table'
  | 'table-row'
  | 'citation-def'
  | 'link-def-title'
  | 'math-inline'
  | 'math-display'
  | 'html-block'
  | 'done'
  | 'error';

export interface StreamError {
  message: string;
  index: number;
  line: number;
  column: number;
}

export interface MarkdownWarning {
  code:
    | 'unterminated_construct'
    | 'unmatched_closer'
    | 'invalid_link'
    | 'unknown_construct'
    | 'unresolved_citation_ref'
    | 'unused_citation_def'
    | 'duplicate_citation_def'
    | 'table_overflow'
    | 'malformed_table_alignment'
    | 'unresolved_link_ref'
    | 'unused_link_def'
    | 'duplicate_link_def'
    | 'unterminated_math'
    | 'unterminated_html';
  index: number;
  detail?: string;
}

export type AstNodeKind =
  | 'document'
  | 'paragraph'
  | 'heading'
  | 'blockquote'
  | 'list'
  | 'list-item'
  | 'code-block'
  | 'thematic-break'
  | 'text'
  | 'emphasis'
  | 'strong'
  | 'strikethrough'
  | 'inline-code'
  | 'link'
  | 'autolink'
  | 'image'
  | 'soft-break'
  | 'hard-break'
  | 'table'
  | 'table-row'
  | 'table-cell'
  | 'citation-reference'
  | 'link-reference'
  | 'math-inline'
  | 'math-display'
  | 'html-inline'
  | 'html-block';

interface AstNodeBase {
  id: number;
  kind: AstNodeKind;
  parentId: number | null;
  status: StreamStatus;
}

export interface DocumentAstNode extends AstNodeBase {
  kind: 'document';
  children: number[];
}

export interface ParagraphAstNode extends AstNodeBase {
  kind: 'paragraph';
  children: number[];
}

export interface HeadingAstNode extends AstNodeBase {
  kind: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children: number[];
}

export interface BlockquoteAstNode extends AstNodeBase {
  kind: 'blockquote';
  children: number[];
}

export interface ListAstNode extends AstNodeBase {
  kind: 'list';
  ordered: boolean;
  start: number | null;
  tight: boolean;
  /** Column where the marker character appears (0-based). */
  markerCol: number;
  /** Column where item content starts (after marker + space). */
  contentCol: number;
  children: number[];
}

export interface ListItemAstNode extends AstNodeBase {
  kind: 'list-item';
  task?: { checked: boolean };
  children: number[];
}

export interface CodeBlockAstNode extends AstNodeBase {
  kind: 'code-block';
  variant: 'fenced' | 'indented';
  language: string;
  text: string;
}

export interface ThematicBreakAstNode extends AstNodeBase {
  kind: 'thematic-break';
}

export interface TextAstNode extends AstNodeBase {
  kind: 'text';
  text: string;
}

export interface EmphasisAstNode extends AstNodeBase {
  kind: 'emphasis';
  children: number[];
}

export interface StrongAstNode extends AstNodeBase {
  kind: 'strong';
  children: number[];
}

export interface StrikethroughAstNode extends AstNodeBase {
  kind: 'strikethrough';
  children: number[];
}

export interface InlineCodeAstNode extends AstNodeBase {
  kind: 'inline-code';
  text: string;
}

export interface LinkAstNode extends AstNodeBase {
  kind: 'link';
  url: string;
  title: string;
  children: number[];
}

export interface AutolinkAstNode extends AstNodeBase {
  kind: 'autolink';
  url: string;
  text: string;
}

export interface ImageAstNode extends AstNodeBase {
  kind: 'image';
  url: string;
  title: string;
  alt: string;
}

export interface SoftBreakAstNode extends AstNodeBase {
  kind: 'soft-break';
}

export interface HardBreakAstNode extends AstNodeBase {
  kind: 'hard-break';
}

export interface TableAstNode extends AstNodeBase {
  kind: 'table';
  alignments: ReadonlyArray<Alignment>;
  children: number[];
}

export interface TableRowAstNode extends AstNodeBase {
  kind: 'table-row';
  isHeader: boolean;
  children: number[];
}

export interface TableCellAstNode extends AstNodeBase {
  kind: 'table-cell';
  alignment: Alignment;
  children: number[];
}

export interface CitationReferenceAstNode extends AstNodeBase {
  kind: 'citation-reference';
  refId: string;
  index: number;
  resolved: boolean;
}

export interface LinkReferenceAstNode extends AstNodeBase {
  kind: 'link-reference';
  /** Normalized label: trimmed, whitespace-collapsed, lower-cased. */
  refId: string;
  /** Original label as authored. */
  label: string;
  form: 'full' | 'collapsed' | 'shortcut';
  children: number[];
  resolved: boolean;
  url: string;
  title: string;
}

export interface MathInlineAstNode extends AstNodeBase {
  kind: 'math-inline';
  text: string;
  delimiter: '$' | '\\(\\)';
}

export interface MathDisplayAstNode extends AstNodeBase {
  kind: 'math-display';
  text: string;
  delimiter: '$$' | '\\[\\]';
}

export interface HtmlInlineAstNode extends AstNodeBase {
  kind: 'html-inline';
  raw: string;
}

export interface HtmlBlockAstNode extends AstNodeBase {
  kind: 'html-block';
  raw: string;
  htmlKind: HtmlBlockKind;
}

export type AstNode =
  | DocumentAstNode
  | ParagraphAstNode
  | HeadingAstNode
  | BlockquoteAstNode
  | ListAstNode
  | ListItemAstNode
  | CodeBlockAstNode
  | ThematicBreakAstNode
  | TextAstNode
  | EmphasisAstNode
  | StrongAstNode
  | StrikethroughAstNode
  | InlineCodeAstNode
  | LinkAstNode
  | AutolinkAstNode
  | ImageAstNode
  | SoftBreakAstNode
  | HardBreakAstNode
  | TableAstNode
  | TableRowAstNode
  | TableCellAstNode
  | CitationReferenceAstNode
  | LinkReferenceAstNode
  | MathInlineAstNode
  | MathDisplayAstNode
  | HtmlInlineAstNode
  | HtmlBlockAstNode;

export interface StreamState {
  nodes: AstNode[];
  rootId: number | null;
  error: StreamError | null;
  warnings: MarkdownWarning[];
  complete: boolean;
}

export interface InternalState extends StreamState {
  nextId: number;
  mode: ParseMode;
  /** Stack of open container node ids (paragraph, list-item, blockquote, …). */
  stack: number[];
  /** Cursor through the in-progress chunk. */
  index: number;
  line: number;
  column: number;
  /** Buffer for the current line being parsed (block-level). */
  lineBuffer: string;
  /** Inline-level buffer for the currently-streaming text node. */
  textBuffer: string;
  /** Active node id at the deepest level of the parser, if any. */
  currentNodeId: number | null;
  options: ResolvedParserOptions;
  /** When in math mode, which opener was used so we know how to close. */
  mathOpener: '$' | '$$' | '\\(' | '\\[' | null;
  /** Currently open math node id, if any. */
  mathNodeId: number | null;
  /** Currently open HTML block kind, if any. */
  htmlBlockKind: HtmlBlockKind | null;
  /** Currently open HTML block node id, if any. */
  htmlBlockNodeId: number | null;
  /** Reserved for future character-level inline HTML pending matches. */
  htmlInlinePending: string;
  /** Map of citation id → 1-based parser-assigned index. Stable across the parse. */
  citationIndex: Map<string, number>;
  /** Map of citation id → AstNode ids of references encountered for that id. */
  citationRefIds: Map<string, number[]>;
  /** Map of citation id → CitationDefinition body (lifted to document.citations). */
  citationDefs: Map<string, {
    id: string;
    index: number;
    childAstIds: number[];
    status: StreamStatus;
  }>;
  /** Map of normalized link label → AstNode ids of unresolved/touched references. */
  linkRefIds: Map<string, number[]>;
  /** Map of normalized link label → definition body. First-seen wins. */
  linkDefs: Map<string, LinkDefinition>;
  /** Running counter for the next citation index to assign. */
  nextCitationIndex: number;
  /**
   * If non-null, the previous line was a candidate table header; we are waiting
   * for the next line to either confirm (alignment row) or revert.
   */
  tablePending: { headerLine: string; paragraphId: number | null } | null;
  /**
   * Stack of currently open list contexts, innermost last.
   * Each entry tracks the list's node id, ordered-ness, and indentation geometry.
   */
  listStack: Array<{
    listId: number;
    ordered: boolean;
    markerCol: number;
    contentCol: number;
  }>;
}

// ────────────────────────────────────────────────────────────────────────────
// Push-style public API
// ────────────────────────────────────────────────────────────────────────────

export type MarkdownNodeType = AstNodeKind;

export interface MarkdownNodeBase {
  readonly id: number;
  readonly type: MarkdownNodeType;
  status: StreamStatus;
  parent: MarkdownNode | null;
  index: number | null;
}

export interface MarkdownDocumentNode extends MarkdownNodeBase {
  readonly type: 'document';
  children: MarkdownBlockNode[];
  citations: Map<string, CitationDefinition>;
  linkDefinitions: Map<string, LinkDefinition>;
}

export interface MarkdownParagraphNode extends MarkdownNodeBase {
  readonly type: 'paragraph';
  children: MarkdownInlineNode[];
}

export interface MarkdownHeadingNode extends MarkdownNodeBase {
  readonly type: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children: MarkdownInlineNode[];
}

export interface MarkdownBlockquoteNode extends MarkdownNodeBase {
  readonly type: 'blockquote';
  children: MarkdownBlockNode[];
}

export interface MarkdownListNode extends MarkdownNodeBase {
  readonly type: 'list';
  ordered: boolean;
  start: number | null;
  tight: boolean;
  /** Column where the marker character appears (0-based). Advisory. */
  markerCol: number;
  /** Column where item content starts (after marker + space). Advisory. */
  contentCol: number;
  children: MarkdownListItemNode[];
}

export interface MarkdownListItemNode extends MarkdownNodeBase {
  readonly type: 'list-item';
  task?: { checked: boolean };
  children: MarkdownBlockNode[];
}

export interface MarkdownCodeBlockNode extends MarkdownNodeBase {
  readonly type: 'code-block';
  variant: 'fenced' | 'indented';
  language: string;
  text: string;
}

export interface MarkdownMathDisplayNode extends MarkdownNodeBase {
  readonly type: 'math-display';
  text: string;
  delimiter: '$$' | '\\[\\]';
}

export interface MarkdownHtmlBlockNode extends MarkdownNodeBase {
  readonly type: 'html-block';
  raw: string;
  htmlKind: HtmlBlockKind;
}

export interface MarkdownThematicBreakNode extends MarkdownNodeBase {
  readonly type: 'thematic-break';
}

export interface MarkdownTextNode extends MarkdownNodeBase {
  readonly type: 'text';
  text: string;
}

export interface MarkdownEmphasisNode extends MarkdownNodeBase {
  readonly type: 'emphasis';
  children: MarkdownInlineNode[];
}

export interface MarkdownStrongNode extends MarkdownNodeBase {
  readonly type: 'strong';
  children: MarkdownInlineNode[];
}

export interface MarkdownStrikethroughNode extends MarkdownNodeBase {
  readonly type: 'strikethrough';
  children: MarkdownInlineNode[];
}

export interface MarkdownInlineCodeNode extends MarkdownNodeBase {
  readonly type: 'inline-code';
  text: string;
}

export interface MarkdownMathInlineNode extends MarkdownNodeBase {
  readonly type: 'math-inline';
  text: string;
  delimiter: '$' | '\\(\\)';
}

export interface MarkdownHtmlInlineNode extends MarkdownNodeBase {
  readonly type: 'html-inline';
  raw: string;
}

export interface MarkdownLinkNode extends MarkdownNodeBase {
  readonly type: 'link';
  url: string;
  title: string;
  children: MarkdownInlineNode[];
}

export interface MarkdownAutolinkNode extends MarkdownNodeBase {
  readonly type: 'autolink';
  url: string;
  text: string;
}

export interface MarkdownImageNode extends MarkdownNodeBase {
  readonly type: 'image';
  url: string;
  title: string;
  alt: string;
}

export interface MarkdownSoftBreakNode extends MarkdownNodeBase {
  readonly type: 'soft-break';
}

export interface MarkdownHardBreakNode extends MarkdownNodeBase {
  readonly type: 'hard-break';
}

export interface CitationDefinition {
  id: string;
  index: number;
  children: MarkdownInlineNode[];
  status: StreamStatus;
}

export interface LinkDefinition {
  id: string;
  label: string;
  url: string;
  title: string;
  status: StreamStatus;
}

export interface MarkdownTableNode extends MarkdownNodeBase {
  readonly type: 'table';
  alignments: ReadonlyArray<Alignment>;
  children: MarkdownTableRowNode[];
}

export interface MarkdownTableRowNode extends MarkdownNodeBase {
  readonly type: 'table-row';
  isHeader: boolean;
  children: MarkdownTableCellNode[];
}

export interface MarkdownTableCellNode extends MarkdownNodeBase {
  readonly type: 'table-cell';
  alignment: Alignment;
  children: MarkdownInlineNode[];
}

/**
 * Inline citation reference. Note: `index` shadows MarkdownNodeBase.index —
 * for citation-reference nodes, this is the parser-assigned 1-based citation
 * number (NOT the sibling position).
 */
export interface MarkdownCitationReferenceNode extends MarkdownNodeBase {
  readonly type: 'citation-reference';
  refId: string;
  index: number;
  resolved: boolean;
}

export interface MarkdownLinkReferenceNode extends MarkdownNodeBase {
  readonly type: 'link-reference';
  refId: string;
  label: string;
  form: 'full' | 'collapsed' | 'shortcut';
  children: MarkdownInlineNode[];
  resolved: boolean;
  url: string;
  title: string;
}

export type MarkdownBlockNode =
  | MarkdownParagraphNode
  | MarkdownHeadingNode
  | MarkdownBlockquoteNode
  | MarkdownListNode
  | MarkdownCodeBlockNode
  | MarkdownMathDisplayNode
  | MarkdownHtmlBlockNode
  | MarkdownThematicBreakNode
  | MarkdownTableNode;

export type MarkdownInlineNode =
  | MarkdownTextNode
  | MarkdownEmphasisNode
  | MarkdownStrongNode
  | MarkdownStrikethroughNode
  | MarkdownInlineCodeNode
  | MarkdownMathInlineNode
  | MarkdownHtmlInlineNode
  | MarkdownLinkNode
  | MarkdownAutolinkNode
  | MarkdownImageNode
  | MarkdownSoftBreakNode
  | MarkdownHardBreakNode
  | MarkdownCitationReferenceNode
  | MarkdownLinkReferenceNode;

export type MarkdownNode =
  | MarkdownDocumentNode
  | MarkdownBlockNode
  | MarkdownInlineNode
  | MarkdownListItemNode
  | MarkdownTableRowNode
  | MarkdownTableCellNode;

// ────────────────────────────────────────────────────────────────────────────
// Events
// ────────────────────────────────────────────────────────────────────────────

export type ParseEventType = 'node-created' | 'value-updated' | 'node-completed';

export interface ParseEvent {
  type: ParseEventType;
  node: MarkdownNode;
  /**
   * Characters appended this push. Defined for `value-updated` events on
   * streaming text content (text, inline-code, code-block, html-block, math-display).
   * Undefined for `value-updated` events emitted on flag mutations
   * (e.g., `link-reference.resolved` flip, `citation-reference.resolved` flip,
   * `task.checked` change).
   */
  delta?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Push-style parser interface
// ────────────────────────────────────────────────────────────────────────────

export interface PartialMarkdownParser {
  push(chunk: string): ParseEvent[];
  finish(): ParseEvent[];
  readonly root: MarkdownDocumentNode | null;
  getByPath(path: string): MarkdownNode | null;
}
