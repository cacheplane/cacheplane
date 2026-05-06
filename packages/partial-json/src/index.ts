// SPDX-License-Identifier: MIT
//
// @cacheplane/partial-json — streaming partial-JSON parser
//
// Two public APIs over the same core tokenizer:
//   - Pull-style:  create() → push(state, chunk) → finish(state) → resolve(state)
//   - Push-style:  createPartialJsonParser() → parser.push(chunk) → events
//
// Both share the same node graph internally; mix freely.

// ── Pull-style (immutable state) ─────────────────────────────────────────────
export type {
  AstNode,
  ArrayNode,
  BoolNode,
  JsonValue,
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

export { resolve } from "./resolve";

// ── Push-style (parser + events) ─────────────────────────────────────────────
export type {
  JsonNodeType,
  StreamStatus,
  JsonNodeBase,
  JsonObjectNode,
  JsonArrayNode,
  JsonStringNode,
  JsonNumberNode,
  JsonBooleanNode,
  JsonNullNode,
  JsonNode,
  ParseEvent,
  PartialJsonParser,
} from "./types";

export { createPartialJsonParser } from "./parser";
export { materialize } from "./materialize";
