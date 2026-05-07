// SPDX-License-Identifier: MIT
import type { InternalState } from './types';
import { setStatus, pushWarning } from './internals';
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

  // Flush any pending table-header candidate as a paragraph (no warning;
  // EOF without alignment row is normal).
  if (s.tablePending !== null) {
    s = appendOrExtendParagraph({ ...s, tablePending: null }, s.tablePending.headerLine);
    s = closeOpenParagraph(s);
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

  return { ...s, complete: true, mode: 'done', stack: [] };
}
