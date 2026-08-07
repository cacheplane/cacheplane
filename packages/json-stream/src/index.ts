export type {
  AstNode,
  ArrayNode,
  BoolNode,
  JsonValue,
  NodeStatus,
  NullNode,
  NumberNode,
  ObjectNode,
  StreamError,
  StreamState,
  StringNode,
} from "./types";

export {
  isArrayNode,
  isBoolNode,
  isComplete,
  isNullNode,
  isNumberNode,
  isObjectNode,
  isStringNode,
} from "./guards";

export { resolve } from "./resolve";

import { createInternal } from "./create";
import { pushInternal } from "./push";
import { finishInternal } from "./finish";
import type { InternalState, StreamState } from "./types";

export function create(): StreamState {
  return createInternal();
}

export function push(state: StreamState, chunk: string): StreamState {
  return pushInternal(state as InternalState, chunk);
}

export function finish(state: StreamState): StreamState {
  return finishInternal(state as InternalState);
}
