import { describe, expect, test } from "vitest";
import { create, push, finish, resolve } from "../index";
import type {
  AstNode,
  StreamState,
  NullNode,
  BoolNode,
  NumberNode,
  StringNode,
  ArrayNode,
  ObjectNode,
} from "../index";

describe("types", () => {
  test("StreamState shape is importable and has correct structure", () => {
    const state: StreamState = {
      nodes: [],
      rootId: null,
      error: null,
      complete: false,
    };
    expect(state.nodes).toEqual([]);
    expect(state.rootId).toBeNull();
    expect(state.error).toBeNull();
    expect(state.complete).toBe(false);
  });

  test("AstNode discriminates on kind field", () => {
    const nullNode: NullNode = { id: 0, kind: "null", parentId: null, status: "complete", value: null };
    const boolNode: BoolNode = { id: 1, kind: "boolean", parentId: null, status: "complete", value: true };
    const numberNode: NumberNode = { id: 2, kind: "number", parentId: null, status: "complete", value: 42, buffer: "42" };
    const stringNode: StringNode = { id: 3, kind: "string", parentId: null, status: "complete", value: "hello", buffer: "hello" };
    const arrayNode: ArrayNode = { id: 4, kind: "array", parentId: null, status: "complete", value: [1, 2, 3], children: [0, 1, 2] };
    const objectNode: ObjectNode = { id: 5, kind: "object", parentId: null, status: "complete", value: { a: 1 }, children: [0], keys: ["a"] };

    const nodes: AstNode[] = [nullNode, boolNode, numberNode, stringNode, arrayNode, objectNode];
    expect(nodes[0].kind).toBe("null");
    expect(nodes[1].kind).toBe("boolean");
    expect(nodes[2].kind).toBe("number");
    expect(nodes[3].kind).toBe("string");
    expect(nodes[4].kind).toBe("array");
    expect(nodes[5].kind).toBe("object");
  });
});

describe("create", () => {
  test("returns empty state with no nodes and no root", () => {
    const state = create();
    expect(state.nodes).toEqual([]);
    expect(state.rootId).toBeNull();
    expect(state.error).toBeNull();
    expect(state.complete).toBe(false);
  });
});

describe("resolve", () => {
  test("returns undefined for empty state", () => {
    const state = create();
    expect(resolve(state)).toBeUndefined();
  });
});

describe("push — complete primitives", () => {
  test("parses null in single chunk", () => {
    let state = create();
    state = push(state, "null");
    state = finish(state);
    expect(state.complete).toBe(true);
    expect(state.error).toBeNull();
    expect(resolve(state)).toBeNull();
  });

  test("parses true", () => {
    let state = create();
    state = push(state, "true");
    state = finish(state);
    expect(resolve(state)).toBe(true);
  });

  test("parses false", () => {
    let state = create();
    state = push(state, "false");
    state = finish(state);
    expect(resolve(state)).toBe(false);
  });

  test("skips leading whitespace", () => {
    let state = create();
    state = push(state, "  \n\t null");
    state = finish(state);
    expect(resolve(state)).toBeNull();
  });

  test("allows trailing whitespace", () => {
    let state = create();
    state = push(state, "true  \n  ");
    state = finish(state);
    expect(state.complete).toBe(true);
  });
});

describe("push — strings", () => {
  test("parses simple string", () => {
    let state = create();
    state = push(state, '"hello"');
    state = finish(state);
    expect(resolve(state)).toBe("hello");
  });

  test("parses empty string", () => {
    let state = create();
    state = push(state, '""');
    state = finish(state);
    expect(resolve(state)).toBe("");
  });

  test("parses escape sequences", () => {
    let state = create();
    state = push(state, '"hello\\nworld\\t!"');
    state = finish(state);
    expect(resolve(state)).toBe("hello\nworld\t!");
  });

  test("parses unicode escape", () => {
    let state = create();
    state = push(state, '"\\u0041"');
    state = finish(state);
    expect(resolve(state)).toBe("A");
  });

  test("parses escaped quotes", () => {
    let state = create();
    state = push(state, '"say \\"hi\\""');
    state = finish(state);
    expect(resolve(state)).toBe('say "hi"');
  });

  test("parses backslash escape", () => {
    let state = create();
    state = push(state, '"path\\\\to\\\\file"');
    state = finish(state);
    expect(resolve(state)).toBe("path\\to\\file");
  });

  test("parses solidus escape", () => {
    let state = create();
    state = push(state, '"a\\/b"');
    state = finish(state);
    expect(resolve(state)).toBe("a/b");
  });
});

describe("push — numbers", () => {
  const valid: [string, number][] = [
    ["0", 0], ["-0", -0], ["1", 1], ["-1", -1], ["42", 42],
    ["1.5", 1.5], ["-1.5", -1.5], ["1e10", 1e10], ["1E10", 1e10],
    ["1e+10", 1e10], ["1e-10", 1e-10], ["1.5e10", 1.5e10],
    ["123456789", 123456789], ["1e308", 1e308],
  ];

  for (const [input, expected] of valid) {
    test(`parses ${input}`, () => {
      let state = create();
      state = push(state, input);
      state = finish(state);
      expect(state.error).toBeNull();
      expect(resolve(state)).toBe(expected);
    });
  }

  test("rejects 01 (leading zero)", () => {
    let state = create();
    state = push(state, "01");
    expect(state.error).not.toBeNull();
  });

  test("rejects 00", () => {
    let state = create();
    state = push(state, "00");
    expect(state.error).not.toBeNull();
  });

  test("rejects +1", () => {
    let state = create();
    state = push(state, "+1");
    expect(state.error).not.toBeNull();
  });

  test("rejects .5", () => {
    let state = create();
    state = push(state, ".5");
    expect(state.error).not.toBeNull();
  });

  test("rejects 1. at finish", () => {
    let state = create();
    state = push(state, "1.");
    state = finish(state);
    expect(state.error).not.toBeNull();
  });

  test("rejects 1e at finish", () => {
    let state = create();
    state = push(state, "1e");
    state = finish(state);
    expect(state.error).not.toBeNull();
  });

  test("rejects 1e+ at finish", () => {
    let state = create();
    state = push(state, "1e+");
    state = finish(state);
    expect(state.error).not.toBeNull();
  });

  test("number terminated by non-number char", () => {
    let state = create();
    state = push(state, "[42]");
    state = finish(state);
    expect(resolve(state)).toEqual([42]);
  });
});

describe("push — arrays", () => {
  test("parses empty array", () => {
    let state = create();
    state = push(state, "[]");
    state = finish(state);
    expect(resolve(state)).toEqual([]);
  });

  test("parses array with single element", () => {
    let state = create();
    state = push(state, "[1]");
    state = finish(state);
    expect(resolve(state)).toEqual([1]);
  });

  test("parses array with multiple elements", () => {
    let state = create();
    state = push(state, '[1, "two", true, null]');
    state = finish(state);
    expect(resolve(state)).toEqual([1, "two", true, null]);
  });

  test("parses nested arrays", () => {
    let state = create();
    state = push(state, "[[1, 2], [3, 4]]");
    state = finish(state);
    expect(resolve(state)).toEqual([[1, 2], [3, 4]]);
  });

  test("parses array with whitespace", () => {
    let state = create();
    state = push(state, "[ 1 , 2 , 3 ]");
    state = finish(state);
    expect(resolve(state)).toEqual([1, 2, 3]);
  });
});

describe("push — objects", () => {
  test("parses empty object", () => {
    let state = create();
    state = push(state, "{}");
    state = finish(state);
    expect(resolve(state)).toEqual({});
  });

  test("parses object with single key", () => {
    let state = create();
    state = push(state, '{"a": 1}');
    state = finish(state);
    expect(resolve(state)).toEqual({ a: 1 });
  });

  test("parses object with multiple keys", () => {
    let state = create();
    state = push(state, '{"a": 1, "b": "two", "c": true}');
    state = finish(state);
    expect(resolve(state)).toEqual({ a: 1, b: "two", c: true });
  });

  test("parses nested objects", () => {
    let state = create();
    state = push(state, '{"outer": {"inner": 42}}');
    state = finish(state);
    expect(resolve(state)).toEqual({ outer: { inner: 42 } });
  });

  test("parses object with array value", () => {
    let state = create();
    state = push(state, '{"items": [1, 2, 3]}');
    state = finish(state);
    expect(resolve(state)).toEqual({ items: [1, 2, 3] });
  });

  test("parses complex nested structure", () => {
    let state = create();
    state = push(state, '{"users": [{"name": "Alice", "scores": [10, 20]}, {"name": "Bob", "scores": [30]}]}');
    state = finish(state);
    expect(resolve(state)).toEqual({
      users: [
        { name: "Alice", scores: [10, 20] },
        { name: "Bob", scores: [30] },
      ],
    });
  });
});

describe("multi-chunk streaming", () => {
  test("literal split across chunks (t-r-u-e)", () => {
    let state = create();
    state = push(state, "t");
    state = push(state, "r");
    state = push(state, "u");
    state = push(state, "e");
    state = finish(state);
    expect(resolve(state)).toBe(true);
  });

  test("string split across chunks", () => {
    let state = create();
    state = push(state, '"hel');
    state = push(state, 'lo"');
    state = finish(state);
    expect(resolve(state)).toBe("hello");
  });

  test("number split across chunks", () => {
    let state = create();
    state = push(state, "1");
    state = push(state, "2");
    state = push(state, "3");
    state = push(state, ".4");
    state = push(state, "5");
    state = finish(state);
    expect(resolve(state)).toBe(123.45);
  });

  test("object split across chunks", () => {
    let state = create();
    state = push(state, '{"hel');
    state = push(state, 'lo": 1}');
    state = finish(state);
    expect(resolve(state)).toEqual({ hello: 1 });
  });

  test("complete JSON parsed one character at a time", () => {
    const json = '{"a": [1, "b", true, null]}';
    let state = create();
    for (const ch of json) {
      state = push(state, ch);
    }
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toEqual({ a: [1, "b", true, null] });
  });
});

describe("finish — unclosed containers", () => {
  test("finish reports error for unclosed array with number", () => {
    let state = create();
    state = push(state, "[42");
    state = finish(state);
    expect(state.error).not.toBeNull();
  });

  test("finish reports error for unclosed object with number", () => {
    let state = create();
    state = push(state, '{"a": 42');
    state = finish(state);
    expect(state.error).not.toBeNull();
  });
});
