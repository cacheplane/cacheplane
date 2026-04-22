import { describe, expect, test } from "vitest";
import {
  isNullNode,
  isBoolNode,
  isNumberNode,
  isStringNode,
  isArrayNode,
  isObjectNode,
  isComplete,
} from "../index";
import type { AstNode, NullNode, BoolNode, NumberNode, StringNode, ArrayNode, ObjectNode } from "../index";

const nullNode: NullNode = { id: 0, kind: "null", parentId: null, status: "complete", value: null };
const boolNode: BoolNode = { id: 1, kind: "boolean", parentId: null, status: "complete", value: true };
const numberNode: NumberNode = { id: 2, kind: "number", parentId: null, status: "complete", value: 42, buffer: "42" };
const stringNode: StringNode = { id: 3, kind: "string", parentId: null, status: "complete", value: "hello", buffer: "hello" };
const arrayNode: ArrayNode = { id: 4, kind: "array", parentId: null, status: "complete", value: [], children: [] };
const objectNode: ObjectNode = { id: 5, kind: "object", parentId: null, status: "complete", value: {}, children: [], keys: [] };
const allNodes: AstNode[] = [nullNode, boolNode, numberNode, stringNode, arrayNode, objectNode];

describe("isNullNode", () => {
  test("returns true for null node", () => {
    expect(isNullNode(nullNode)).toBe(true);
  });
  test("returns false for all other node kinds", () => {
    const others = allNodes.filter((n) => n.kind !== "null");
    for (const node of others) {
      expect(isNullNode(node)).toBe(false);
    }
  });
});

describe("isBoolNode", () => {
  test("returns true for boolean node", () => {
    expect(isBoolNode(boolNode)).toBe(true);
  });
  test("returns false for all other node kinds", () => {
    const others = allNodes.filter((n) => n.kind !== "boolean");
    for (const node of others) {
      expect(isBoolNode(node)).toBe(false);
    }
  });
});

describe("isNumberNode", () => {
  test("returns true for number node", () => {
    expect(isNumberNode(numberNode)).toBe(true);
  });
  test("returns false for all other node kinds", () => {
    const others = allNodes.filter((n) => n.kind !== "number");
    for (const node of others) {
      expect(isNumberNode(node)).toBe(false);
    }
  });
});

describe("isStringNode", () => {
  test("returns true for string node", () => {
    expect(isStringNode(stringNode)).toBe(true);
  });
  test("returns false for all other node kinds", () => {
    const others = allNodes.filter((n) => n.kind !== "string");
    for (const node of others) {
      expect(isStringNode(node)).toBe(false);
    }
  });
});

describe("isArrayNode", () => {
  test("returns true for array node", () => {
    expect(isArrayNode(arrayNode)).toBe(true);
  });
  test("returns false for all other node kinds", () => {
    const others = allNodes.filter((n) => n.kind !== "array");
    for (const node of others) {
      expect(isArrayNode(node)).toBe(false);
    }
  });
});

describe("isObjectNode", () => {
  test("returns true for object node", () => {
    expect(isObjectNode(objectNode)).toBe(true);
  });
  test("returns false for all other node kinds", () => {
    const others = allNodes.filter((n) => n.kind !== "object");
    for (const node of others) {
      expect(isObjectNode(node)).toBe(false);
    }
  });
});

describe("isComplete", () => {
  test("returns true for complete nodes", () => {
    for (const node of allNodes) {
      expect(isComplete(node)).toBe(true);
    }
  });
  test("returns false for incomplete nodes", () => {
    const incompleteNode: NullNode = { id: 0, kind: "null", parentId: null, status: "incomplete", value: undefined };
    expect(isComplete(incompleteNode)).toBe(false);
  });
});
