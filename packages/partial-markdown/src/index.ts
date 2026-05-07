// SPDX-License-Identifier: MIT
//
// @cacheplane/partial-markdown — streaming partial-Markdown parser.
//
// Two public APIs over the same core state machine:
//   - Pull-style: create() → push(state, chunk) → finish(state) → resolve(state)
//   - Push-style: createPartialMarkdownParser() → parser.push(chunk) → events
//
// Both share the same node graph internally; mix freely.

// ── Types ──────────────────────────────────────────────────────────────────
export type {
  AstNode,
  AstNodeKind,
  ParseMode,
  StreamError,
  StreamState,
  MarkdownNode,
  MarkdownNodeType,
  StreamStatus,
  MarkdownNodeBase,
  MarkdownDocumentNode,
  MarkdownBlockNode,
  MarkdownInlineNode,
  MarkdownParagraphNode,
  MarkdownHeadingNode,
  MarkdownBlockquoteNode,
  MarkdownListNode,
  MarkdownListItemNode,
  MarkdownCodeBlockNode,
  MarkdownThematicBreakNode,
  MarkdownTextNode,
  MarkdownEmphasisNode,
  MarkdownStrongNode,
  MarkdownStrikethroughNode,
  MarkdownInlineCodeNode,
  MarkdownLinkNode,
  MarkdownAutolinkNode,
  MarkdownImageNode,
  MarkdownSoftBreakNode,
  MarkdownHardBreakNode,
  ParseEvent,
  ParseEventType,
  PartialMarkdownParser,
  MarkdownWarning,
  Alignment,
  CitationDefinition,
  LinkDefinition,
  MarkdownTableNode,
  MarkdownTableRowNode,
  MarkdownTableCellNode,
  MarkdownCitationReferenceNode,
  MarkdownLinkReferenceNode,
} from './types';

// ── Pull-style ─────────────────────────────────────────────────────────────
import { createInternal } from './create';
import { pushInternal } from './push';
import { finishInternal } from './finish';
import type { InternalState, StreamState } from './types';

export function create(): StreamState {
  return createInternal();
}
export function push(state: StreamState, chunk: string): StreamState {
  return pushInternal(state as InternalState, chunk);
}
export function finish(state: StreamState): StreamState {
  return finishInternal(state as InternalState);
}
export { resolve } from './resolve';
export { createPartialMarkdownParser } from './parser';
export { materialize } from './materialize';
export {
  isDocumentNode, isParagraphNode, isHeadingNode, isBlockquoteNode,
  isListNode, isListItemNode, isCodeBlockNode, isThematicBreakNode,
  isTextNode, isEmphasisNode, isStrongNode, isStrikethroughNode,
  isInlineCodeNode, isLinkNode, isAutolinkNode, isImageNode,
  isSoftBreakNode, isHardBreakNode, isCompleteNode,
  isTableNode, isTableRowNode, isTableCellNode, isCitationReferenceNode,
  isLinkReferenceNode,
} from './guards';
