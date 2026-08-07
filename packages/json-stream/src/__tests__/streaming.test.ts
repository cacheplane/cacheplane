import { describe, expect, test } from "vitest";
import { create, push, finish, resolve } from "../index";
import type { ArrayNode, ObjectNode } from "../index";

describe("streaming — partial values", () => {
  test("incomplete array exposes partial value [1, 2]", () => {
    let state = create();
    state = push(state, "[1, 2, ");
    // Not finished — resolve should show partial [1, 2]
    expect(resolve(state)).toEqual([1, 2]);
  });

  test("incomplete object exposes partial value { a: 1 }", () => {
    let state = create();
    state = push(state, '{"a": 1, "b":');
    // "b"'s value not yet arrived — only "a": 1 is complete
    expect(resolve(state)).toEqual({ a: 1 });
  });

  test("incomplete object with second complete value exposes both", () => {
    let state = create();
    state = push(state, '{"a": 1, "b": 2, "c":');
    expect(resolve(state)).toEqual({ a: 1, b: 2 });
  });

  test("array grows element by element", () => {
    let state = create();

    state = push(state, "[");
    expect(resolve(state)).toEqual([]);

    state = push(state, "1,");
    expect(resolve(state)).toEqual([1]);

    state = push(state, "2,");
    expect(resolve(state)).toEqual([1, 2]);

    state = push(state, "3]");
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toEqual([1, 2, 3]);
  });

  test("object grows key by key", () => {
    let state = create();

    state = push(state, "{");
    expect(resolve(state)).toEqual({});

    state = push(state, '"a": 1,');
    expect(resolve(state)).toEqual({ a: 1 });

    state = push(state, '"b": 2}');
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toEqual({ a: 1, b: 2 });
  });
});

describe("streaming — identity preservation", () => {
  test("unchanged nodes keep same reference after push — complete array plus whitespace", () => {
    // After "[1, 2, 3]" is pushed, the root node is fully resolved with value [1, 2, 3].
    // Pushing whitespace after a complete array (in Done mode) doesn't change any node.
    let state = create();
    state = push(state, "[1, 2, 3]");

    const rootId = state.rootId!;
    const rootNodeBefore = state.nodes[rootId] as ArrayNode;

    // Push whitespace only — no structural change
    state = push(state, "  ");

    const rootNodeAfter = state.nodes[rootId] as ArrayNode;
    expect(rootNodeAfter).toBe(rootNodeBefore);
  });

  test("root value reference changes when new element completes in array", () => {
    // After "[1, 2, " the array has 2 complete children (comma terminated 2).
    // After adding "3" the array gets a third child.
    let state = create();
    state = push(state, "[1, 2, ");

    const rootId = state.rootId!;
    const valueBefore = (state.nodes[rootId] as ArrayNode).value;
    expect(valueBefore).toEqual([1, 2]);

    // Completing element 3 terminates the number — need a closing bracket or comma
    state = push(state, "3]");
    state = finish(state);
    expect(state.error).toBeNull();

    const valueAfter = (state.nodes[rootId] as ArrayNode).value;
    // A new element was added, so the value array should be a new reference
    expect(valueAfter).not.toBe(valueBefore);
    expect(valueAfter).toEqual([1, 2, 3]);
  });

  test("root value reference preserved when no structural change (whitespace-only push)", () => {
    let state = create();
    state = push(state, "[1, 2, 3]");

    const rootId = state.rootId!;
    const valueBefore = (state.nodes[rootId] as ArrayNode).value;

    // Push whitespace — no change in structure
    state = push(state, "  ");

    const valueAfter = (state.nodes[rootId] as ArrayNode).value;
    expect(valueAfter).toBe(valueBefore);
  });

  test("unchanged inner container keeps same value reference after outer gets new element", () => {
    let state = create();
    // Start with outer array containing a complete inner array [1, 2]
    // The comma after ] means [1, 2] is complete and the outer is waiting for next item
    state = push(state, "[[1, 2], ");

    const rootId = state.rootId!;
    const rootNode = state.nodes[rootId] as ArrayNode;
    // The inner array is the first child of root
    const innerId = rootNode.children[0];
    const innerValueBefore = (state.nodes[innerId] as ArrayNode).value;
    expect(innerValueBefore).toEqual([1, 2]);

    // Add another element to the outer array
    state = push(state, "3]");
    state = finish(state);
    expect(state.error).toBeNull();

    const innerValueAfter = (state.nodes[innerId] as ArrayNode).value;
    // Inner array [1, 2] was not changed — same reference
    expect(innerValueAfter).toBe(innerValueBefore);
  });

  test("sibling identity — earlier siblings unchanged when later sibling completes", () => {
    // After "[1, 2, " — both 1 and 2 are complete children
    let state = create();
    state = push(state, "[1, 2, ");

    const rootId = state.rootId!;
    const rootNode = state.nodes[rootId] as ArrayNode;
    // id of the node for value 1
    const firstChildId = rootNode.children[0];
    const firstChildBefore = state.nodes[firstChildId];

    // Complete the third element
    state = push(state, "3]");

    const firstChildAfter = state.nodes[firstChildId];
    expect(firstChildAfter).toBe(firstChildBefore);
  });

  test("object value reference preserved when no structural change (whitespace in value position)", () => {
    // After {"a": 1, "b": — "a":1 is complete, "b" key parsed, waiting for value
    let state = create();
    state = push(state, '{"a": 1, "b": ');
    const rootId = state.rootId!;
    const valueBefore = (state.nodes[rootId] as ObjectNode).value;
    // Only "a" is complete so value should be { a: 1 }
    expect(valueBefore).toEqual({ a: 1 });

    // Push more whitespace — no structural change
    state = push(state, "   ");
    const valueAfter = (state.nodes[rootId] as ObjectNode).value;
    expect(valueAfter).toBe(valueBefore);
  });

  test("object value changes reference when new key-value pair completes", () => {
    // After {"a": 1, — "a":1 is complete, waiting for next key
    let state = create();
    state = push(state, '{"a": 1, ');

    const rootId = state.rootId!;
    const valueBefore = (state.nodes[rootId] as ObjectNode).value;
    expect(valueBefore).toEqual({ a: 1 });

    // Complete another key-value pair — need closing bracket or comma to terminate number
    state = push(state, '"b": 2}');
    state = finish(state);
    expect(state.error).toBeNull();

    const valueAfter = (state.nodes[rootId] as ObjectNode).value;
    expect(valueAfter).not.toBe(valueBefore);
    expect(valueAfter).toEqual({ a: 1, b: 2 });
  });
});

describe("streaming — finish completes partial state", () => {
  test("complete array via finish", () => {
    let state = create();
    state = push(state, "[1, 2, 3]");
    state = finish(state);
    expect(state.complete).toBe(true);
    expect(state.error).toBeNull();
    expect(resolve(state)).toEqual([1, 2, 3]);
  });

  test("empty push followed by finish on primitive", () => {
    let state = create();
    state = push(state, "42");
    state = finish(state);
    expect(state.complete).toBe(true);
    expect(resolve(state)).toBe(42);
  });

  test("multiple pushes of whitespace before value", () => {
    let state = create();
    state = push(state, "   ");
    state = push(state, "\t");
    state = push(state, "\n");
    state = push(state, "true");
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toBe(true);
  });
});
