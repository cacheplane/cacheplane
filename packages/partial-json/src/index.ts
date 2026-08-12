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
} from "@cacheplane/json-stream";

export {
  isArrayNode,
  isBoolNode,
  isComplete,
  isNullNode,
  isNumberNode,
  isObjectNode,
  isStringNode,
} from "@cacheplane/json-stream";

export { create, finish, push, resolve } from "@cacheplane/json-stream";

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
