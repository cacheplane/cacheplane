export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type NodeStatus = "complete" | "incomplete";

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
  status: NodeStatus;
  value: null | undefined;
}

export interface BoolNode {
  id: number;
  kind: "boolean";
  parentId: number | null;
  status: NodeStatus;
  value: boolean | undefined;
}

export interface NumberNode {
  id: number;
  kind: "number";
  parentId: number | null;
  status: NodeStatus;
  value: number | undefined;
  buffer: string;
}

export interface StringNode {
  id: number;
  kind: "string";
  parentId: number | null;
  status: NodeStatus;
  value: string | undefined;
  buffer: string;
}

export interface ArrayNode {
  id: number;
  kind: "array";
  parentId: number | null;
  status: NodeStatus;
  value: JsonValue[] | undefined;
  children: number[];
}

export interface ObjectNode {
  id: number;
  kind: "object";
  parentId: number | null;
  status: NodeStatus;
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
