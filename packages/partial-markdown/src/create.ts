// SPDX-License-Identifier: MIT
import type { InternalState } from './types';

export function createInternal(): InternalState {
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
    textBuffer: '',
    currentNodeId: null,
    citationIndex: new Map(),
    citationRefIds: new Map(),
    citationDefs: new Map(),
    nextCitationIndex: 1,
    tablePending: null,
    listStack: [],
  };
}
