export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type AstNodeStatus = "complete" | "incomplete";

export interface StreamError {
  message: string;
  index: number;
  line: number;
  column: number;
}

export interface NullNode {
  id: number;
  kind: "null";
  parentId: number | null;
  status: AstNodeStatus;
  value: null | undefined;
}

export interface BoolNode {
  id: number;
  kind: "boolean";
  parentId: number | null;
  status: AstNodeStatus;
  value: boolean | undefined;
}

export interface NumberNode {
  id: number;
  kind: "number";
  parentId: number | null;
  status: AstNodeStatus;
  value: number | undefined;
  buffer: string;
}

export interface StringNode {
  id: number;
  kind: "string";
  parentId: number | null;
  status: AstNodeStatus;
  value: string | undefined;
  buffer: string;
}

export interface ArrayNode {
  id: number;
  kind: "array";
  parentId: number | null;
  status: AstNodeStatus;
  value: JsonValue[] | undefined;
  children: number[];
}

export interface ObjectNode {
  id: number;
  kind: "object";
  parentId: number | null;
  status: AstNodeStatus;
  value: Record<string, JsonValue> | undefined;
  children: number[];
  keys: string[];
}

export type AstNode =
  | NullNode
  | BoolNode
  | NumberNode
  | StringNode
  | ArrayNode
  | ObjectNode;

export type ParseMode =
  | "Value"
  | "StringValue"
  | "NumberValue"
  | "LiteralValue"
  | "ArrayItemOrEnd"
  | "ObjectKeyOrEnd"
  | "ObjectKey"
  | "ObjectColon"
  | "Separator"
  | "Done"
  | "Error";

export interface StreamState {
  nodes: AstNode[];
  rootId: number | null;
  error: StreamError | null;
  complete: boolean;
}

export interface InternalState extends StreamState {
  nextId: number;
  mode: ParseMode;
  stack: number[];
  index: number;
  line: number;
  column: number;
  stringContext: "value" | "key" | null;
  stringEscape: boolean;
  stringUnicode: string | null;
  literalExpected: string | null;
  literalBuffer: string;
  pendingKey: string | null;
  pendingKeyOwner: number | null;
  currentNodeId: number | null;
  keyBuffer: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Push-style API types (createPartialJsonParser).
// These wrap the pull-style state machine (above) with a node tree + events.
// ────────────────────────────────────────────────────────────────────────────

// SPDX-License-Identifier: MIT

/** Kinds of JSON values a node can represent. */
export type JsonNodeType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

/**
 * Parsing / streaming state of a node.
 * Must stay in sync with @cacheplane/internal-types; verified by types.test.ts.
 */
export type StreamStatus = 'pending' | 'streaming' | 'complete';

/** Base shape shared by all nodes. */
export interface JsonNodeBase {
  /** Stable identity — assigned on creation, never changes. */
  readonly id: number;
  /** What kind of JSON value this node represents. */
  readonly type: JsonNodeType;
  /** Parsing state. */
  status: StreamStatus;
  /** Parent node (null for root). */
  parent: JsonNode | null;
  /** Key in parent — string for object properties, number for array indices. */
  key: string | number | null;
}

export interface JsonObjectNode extends JsonNodeBase {
  readonly type: 'object';
  children: Map<string, JsonNode>;
  /** Key currently being built (between quote open and colon). */
  pendingKey: string | null;
}

export interface JsonArrayNode extends JsonNodeBase {
  readonly type: 'array';
  children: JsonNode[];
}

export interface JsonStringNode extends JsonNodeBase {
  readonly type: 'string';
  /** Grows character-by-character as tokens arrive. */
  value: string;
}

export interface JsonNumberNode extends JsonNodeBase {
  readonly type: 'number';
  /** Raw characters accumulated so far. */
  raw: string;
  /** Parsed value — set when node completes. */
  value: number | null;
}

export interface JsonBooleanNode extends JsonNodeBase {
  readonly type: 'boolean';
  value: boolean;
}

export interface JsonNullNode extends JsonNodeBase {
  readonly type: 'null';
}

export type JsonNode =
  | JsonObjectNode
  | JsonArrayNode
  | JsonStringNode
  | JsonNumberNode
  | JsonBooleanNode
  | JsonNullNode;

/** Events emitted by the parser as the tree changes. */
export interface ParseEvent {
  type: 'node-created' | 'value-updated' | 'node-completed';
  node: JsonNode;
  /** For value-updated on strings: the characters appended this push. */
  delta?: string;
}

/** Push-based streaming JSON parser. */
export interface PartialJsonParser {
  /** Feed characters. Returns events for what changed. */
  push(chunk: string): ParseEvent[];
  /** Signal end-of-input; closes any trailing number that was awaiting a terminator. */
  finish(): ParseEvent[];
  /** Root node of the parse tree. */
  readonly root: JsonNode | null;
  /** Look up a node by JSON Pointer path (e.g., "/elements/el-1/props"). */
  getByPath(path: string): JsonNode | null;
}
