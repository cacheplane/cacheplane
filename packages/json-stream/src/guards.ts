import type {
  AstNode,
  ArrayNode,
  BoolNode,
  NullNode,
  NumberNode,
  ObjectNode,
  StringNode,
} from "./types";

export function isNullNode(node: AstNode): node is NullNode {
  return node.kind === "null";
}

export function isBoolNode(node: AstNode): node is BoolNode {
  return node.kind === "boolean";
}

export function isNumberNode(node: AstNode): node is NumberNode {
  return node.kind === "number";
}

export function isStringNode(node: AstNode): node is StringNode {
  return node.kind === "string";
}

export function isArrayNode(node: AstNode): node is ArrayNode {
  return node.kind === "array";
}

export function isObjectNode(node: AstNode): node is ObjectNode {
  return node.kind === "object";
}

export function isComplete(node: AstNode): boolean {
  return node.status === "complete";
}
