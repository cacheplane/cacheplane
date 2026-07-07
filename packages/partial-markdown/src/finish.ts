// SPDX-License-Identifier: MIT
import type { InternalState, ParagraphAstNode, TextAstNode } from './types';
import { setStatus, pushWarning, allocId, appendNode, appendChild } from './internals';
import { handleBlockLine, appendOrExtendParagraph, closeOpenParagraph } from './handlers/block';

export function finishInternal(state: InternalState): InternalState {
  if (state.complete) return state;
  if (state.error) return state;

  let s = state;

  // Flush any pending lineBuffer (content after the last newline that
  // push() never processed). Without this, short inputs like 'hello' or
  // '# heading' that don't end in '\n' produce an empty document tree
  // even after finish() — the buffered line stays unflushed. Live browser
  // smoke caught this when gpt-5-mini emitted a single short reply.
  if (s.lineBuffer.length > 0) {
    const trailing = s.lineBuffer;
    s = handleBlockLine({ ...s, lineBuffer: '' }, trailing);
  }

  // If inline parsing left a partial HTML tag in the pending buffer
  // (e.g. the stream ended mid-tag like "A <spa"), emit a warning and
  // flush the held bytes as a raw text node directly — bypassing parseInline
  // so we do NOT re-enter matchInlineHtml and re-buffer the bytes.
  if (s.htmlInlinePending.length > 0) {
    const flushed = s.htmlInlinePending;
    s = pushWarning(s, {
      code: 'unterminated_html',
      index: s.index,
      detail: 'unterminated inline HTML pending buffer',
    });
    s = { ...s, htmlInlinePending: '' };

    // Ensure an open paragraph exists to attach the text node to.
    let paraId = s.currentNodeId;
    if (paraId === null || s.nodes[paraId]?.kind !== 'paragraph') {
      // Open a new paragraph attached to root.
      const [s1, newParaId] = allocId(s);
      const para: ParagraphAstNode = {
        id: newParaId,
        kind: 'paragraph',
        parentId: s.rootId!,
        status: 'streaming',
        children: [],
      };
      s = appendNode(s1, para);
      s = appendChild(s, s.rootId!, newParaId);
      paraId = newParaId;
      s = { ...s, currentNodeId: paraId };
    }

    // Allocate a text node with the flushed bytes as plain text.
    const [s2, textId] = allocId(s);
    const textNode: TextAstNode = {
      id: textId,
      kind: 'text',
      parentId: paraId,
      status: 'complete',
      text: flushed,
    };
    s = appendNode(s2, textNode);
    s = appendChild(s, paraId, textId);
  }

  // Flush any pending table-header candidate as a paragraph (no warning;
  // EOF without alignment row is normal).
  if (s.tablePending !== null) {
    s = appendOrExtendParagraph({ ...s, tablePending: null }, s.tablePending.headerLine);
    s = closeOpenParagraph(s);
  }

  if (s.htmlBlockNodeId !== null && s.htmlBlockKind !== null) {
    const htmlBlockNodeId = s.htmlBlockNodeId;
    if (s.htmlBlockKind >= 1 && s.htmlBlockKind <= 5) {
      s = pushWarning(s, {
        code: 'unterminated_html',
        index: s.index,
        detail: 'unterminated HTML block',
      });
    }
    s = setStatus(s, htmlBlockNodeId, 'complete');
    s = {
      ...s,
      mode: 'block',
      htmlBlockKind: null,
      htmlBlockNodeId: null,
      currentNodeId: null,
    };
  }

  if (s.mathNodeId !== null) {
    const mathNodeId = s.mathNodeId;
    s = pushWarning(s, {
      code: 'unterminated_math',
      index: s.index,
      detail: 'unterminated math expression',
    });
    s = setStatus(s, mathNodeId, 'complete');
    s = {
      ...s,
      mode: 'block',
      mathOpener: null,
      mathNodeId: null,
      currentNodeId: null,
    };
  }

  // Walk the open-container stack from innermost to outermost. Any node that
  // requires an explicit closer (currently: fenced code blocks) gets a
  // warning before being closed.
  for (let i = s.stack.length - 1; i >= 0; i--) {
    const id = s.stack[i];
    if (id == null) continue;
    const node = s.nodes[id];
    if (!node) continue;

    if (node.kind === 'code-block' && node.variant === 'fenced' && node.status !== 'complete') {
      s = pushWarning(s, {
        code: 'unterminated_construct',
        index: s.index,
        detail: 'fenced code block missing closing fence',
      });
    }
    s = setStatus(s, id, 'complete');
  }

  // Close all top-level streaming nodes (paragraphs, headings, etc.)
  for (let i = 0; i < s.nodes.length; i++) {
    const n = s.nodes[i];
    if (n && n.status !== 'complete') {
      s = setStatus(s, i, 'complete');
    }
  }

  // Mark document complete + state done.
  if (s.rootId !== null) {
    s = setStatus(s, s.rootId, 'complete');
  }

  // Citation orphan warnings.
  const refIdsSeen = new Set(s.citationRefIds.keys());
  const defIdsSeen = new Set(s.citationDefs.keys());

  for (const [refId, refNodeIds] of s.citationRefIds) {
    if (!defIdsSeen.has(refId) && refNodeIds.length > 0) {
      s = pushWarning(s, {
        code: 'unresolved_citation_ref',
        index: s.index,
        detail: `no definition for [^${refId}]`,
      });
    }
  }
  for (const refId of defIdsSeen) {
    if (!refIdsSeen.has(refId)) {
      s = pushWarning(s, {
        code: 'unused_citation_def',
        index: s.index,
        detail: `unused citation definition [^${refId}]`,
      });
    }
  }

  const linkRefIdsSeen = new Set(s.linkRefIds.keys());
  const linkDefIdsSeen = new Set(s.linkDefs.keys());

  for (const [refId, refNodeIds] of s.linkRefIds) {
    if (!linkDefIdsSeen.has(refId) && refNodeIds.length > 0) {
      s = pushWarning(s, {
        code: 'unresolved_link_ref',
        index: s.index,
        detail: `no definition for [${refId}]`,
      });
    }
  }
  for (const refId of linkDefIdsSeen) {
    if (!linkRefIdsSeen.has(refId)) {
      s = pushWarning(s, {
        code: 'unused_link_def',
        index: s.index,
        detail: `unused link definition [${refId}]`,
      });
    }
  }

  return { ...s, complete: true, mode: 'done', stack: [], codeFenceMarker: null };
}
