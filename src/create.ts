import type { InternalState } from "./types";

export function createInternal(): InternalState {
  return {
    nodes: [],
    rootId: null,
    error: null,
    complete: false,
    nextId: 0,
    mode: "Value",
    stack: [],
    index: 0,
    line: 1,
    column: 1,
    stringContext: null,
    stringEscape: false,
    stringUnicode: null,
    literalExpected: null,
    literalBuffer: "",
    pendingKey: null,
    pendingKeyOwner: null,
    currentNodeId: null,
    keyBuffer: "",
  };
}
