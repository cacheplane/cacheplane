// SPDX-License-Identifier: MIT
import type { InternalState, DocumentAstNode } from './types';
import { allocId, appendNode } from './internals';
import { handleBlockLine } from './handlers';

export function pushInternal(state: InternalState, chunk: string): InternalState {
  if (chunk.length === 0 || state.complete || state.error) return state;
  let s = ensureRoot(state);

  let buffer = s.lineBuffer;
  for (let i = 0; i < chunk.length; i++) {
    const ch = chunk[i];
    if (ch === '\n') {
      s = handleBlockLine({ ...s, lineBuffer: buffer }, buffer);
      buffer = '';
    } else if (ch != null) {
      buffer += ch;
    }
  }
  return { ...s, lineBuffer: buffer };
}

function ensureRoot(state: InternalState): InternalState {
  if (state.rootId !== null) return state;
  const [s1, id] = allocId(state);
  const doc: DocumentAstNode = {
    id,
    kind: 'document',
    parentId: null,
    status: 'streaming',
    children: [],
  };
  return { ...appendNode(s1, doc), rootId: id, stack: [id] };
}
