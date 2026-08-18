// SPDX-License-Identifier: MIT
import type { InternalState, PartialMarkdownParserOptions } from './types';

export function createInternal(options?: PartialMarkdownParserOptions): InternalState {
  return {
    nodes: [],
    rootId: null,
    error: null,
    warnings: [],
    complete: false,
    nextId: 0,
    mode: 'block',
    stack: [],
    index: 0,
    line: 1,
    column: 1,
    lineBuffer: '',
    codeFenceMarker: null,
    textBuffer: '',
    currentNodeId: null,
    pendingParagraphBreak: null,
    options: {
      math: {
        dollar: options?.math?.dollar ?? true,
        bracket: options?.math?.bracket ?? true,
      },
    },
    mathOpener: null,
    mathNodeId: null,
    htmlBlockKind: null,
    htmlBlockNodeId: null,
    htmlInlinePending: '',
    citationIndex: new Map(),
    citationRefIds: new Map(),
    citationDefs: new Map(),
    linkRefIds: new Map(),
    linkDefs: new Map(),
    nextCitationIndex: 1,
    tablePending: null,
    listStack: [],
  };
}
