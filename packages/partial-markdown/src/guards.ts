// SPDX-License-Identifier: MIT
import type {
  MarkdownNode,
  MarkdownDocumentNode,
  MarkdownParagraphNode,
  MarkdownHeadingNode,
  MarkdownBlockquoteNode,
  MarkdownListNode,
  MarkdownListItemNode,
  MarkdownCodeBlockNode,
  MarkdownMathDisplayNode,
  MarkdownHtmlBlockNode,
  MarkdownThematicBreakNode,
  MarkdownTextNode,
  MarkdownEmphasisNode,
  MarkdownStrongNode,
  MarkdownStrikethroughNode,
  MarkdownInlineCodeNode,
  MarkdownMathInlineNode,
  MarkdownHtmlInlineNode,
  MarkdownLinkNode,
  MarkdownAutolinkNode,
  MarkdownImageNode,
  MarkdownSoftBreakNode,
  MarkdownHardBreakNode,
  MarkdownTableNode,
  MarkdownTableRowNode,
  MarkdownTableCellNode,
  MarkdownCitationReferenceNode,
  MarkdownLinkReferenceNode,
} from './types';

export function isDocumentNode(n: MarkdownNode): n is MarkdownDocumentNode { return n.type === 'document'; }
export function isParagraphNode(n: MarkdownNode): n is MarkdownParagraphNode { return n.type === 'paragraph'; }
export function isHeadingNode(n: MarkdownNode): n is MarkdownHeadingNode { return n.type === 'heading'; }
export function isBlockquoteNode(n: MarkdownNode): n is MarkdownBlockquoteNode { return n.type === 'blockquote'; }
export function isListNode(n: MarkdownNode): n is MarkdownListNode { return n.type === 'list'; }
export function isListItemNode(n: MarkdownNode): n is MarkdownListItemNode { return n.type === 'list-item'; }
export function isCodeBlockNode(n: MarkdownNode): n is MarkdownCodeBlockNode { return n.type === 'code-block'; }
export function isMathDisplayNode(n: MarkdownNode): n is MarkdownMathDisplayNode { return n.type === 'math-display'; }
export function isHtmlBlockNode(n: MarkdownNode): n is MarkdownHtmlBlockNode { return n.type === 'html-block'; }
export function isThematicBreakNode(n: MarkdownNode): n is MarkdownThematicBreakNode { return n.type === 'thematic-break'; }
export function isTextNode(n: MarkdownNode): n is MarkdownTextNode { return n.type === 'text'; }
export function isEmphasisNode(n: MarkdownNode): n is MarkdownEmphasisNode { return n.type === 'emphasis'; }
export function isStrongNode(n: MarkdownNode): n is MarkdownStrongNode { return n.type === 'strong'; }
export function isStrikethroughNode(n: MarkdownNode): n is MarkdownStrikethroughNode { return n.type === 'strikethrough'; }
export function isInlineCodeNode(n: MarkdownNode): n is MarkdownInlineCodeNode { return n.type === 'inline-code'; }
export function isMathInlineNode(n: MarkdownNode): n is MarkdownMathInlineNode { return n.type === 'math-inline'; }
export function isHtmlInlineNode(n: MarkdownNode): n is MarkdownHtmlInlineNode { return n.type === 'html-inline'; }
export function isLinkNode(n: MarkdownNode): n is MarkdownLinkNode { return n.type === 'link'; }
export function isAutolinkNode(n: MarkdownNode): n is MarkdownAutolinkNode { return n.type === 'autolink'; }
export function isImageNode(n: MarkdownNode): n is MarkdownImageNode { return n.type === 'image'; }
export function isSoftBreakNode(n: MarkdownNode): n is MarkdownSoftBreakNode { return n.type === 'soft-break'; }
export function isHardBreakNode(n: MarkdownNode): n is MarkdownHardBreakNode { return n.type === 'hard-break'; }

export function isCompleteNode(n: MarkdownNode): boolean { return n.status === 'complete'; }

export function isTableNode(n: MarkdownNode): n is MarkdownTableNode { return n.type === 'table'; }
export function isTableRowNode(n: MarkdownNode): n is MarkdownTableRowNode { return n.type === 'table-row'; }
export function isTableCellNode(n: MarkdownNode): n is MarkdownTableCellNode { return n.type === 'table-cell'; }
export function isCitationReferenceNode(n: MarkdownNode): n is MarkdownCitationReferenceNode { return n.type === 'citation-reference'; }
export function isLinkReferenceNode(n: MarkdownNode): n is MarkdownLinkReferenceNode { return n.type === 'link-reference'; }
