import { describe, expect, test } from "vitest";
import { create, push, finish, resolve } from "../index";

describe("edge cases — duplicate object keys", () => {
  test("last value wins for duplicate key", () => {
    let state = create();
    state = push(state, '{"a": 1, "a": 2}');
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toEqual({ a: 2 });
  });

  test("last value wins with three occurrences", () => {
    let state = create();
    state = push(state, '{"a": 1, "a": 2, "a": 3}');
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toEqual({ a: 3 });
  });

  test("duplicate keys mixed with other keys", () => {
    let state = create();
    state = push(state, '{"a": 1, "b": 10, "a": 2}');
    state = finish(state);
    expect(state.error).toBeNull();
    const result = resolve(state) as Record<string, number>;
    expect(result["a"]).toBe(2);
    expect(result["b"]).toBe(10);
  });
});

describe("edge cases — deep nesting", () => {
  test("100 levels of nested arrays", () => {
    const depth = 100;
    const json = "[".repeat(depth) + "1" + "]".repeat(depth);
    let state = create();
    state = push(state, json);
    state = finish(state);
    expect(state.error).toBeNull();
    // Build expected result
    let expected: unknown = 1;
    for (let i = 0; i < depth; i++) {
      expected = [expected];
    }
    expect(resolve(state)).toEqual(expected);
  });

  test("100 levels of nested objects", () => {
    const depth = 100;
    let json = "";
    for (let i = 0; i < depth; i++) {
      json += '{"x": ';
    }
    json += "1";
    for (let i = 0; i < depth; i++) {
      json += "}";
    }
    let state = create();
    state = push(state, json);
    state = finish(state);
    expect(state.error).toBeNull();
    // Build expected result
    let expected: unknown = 1;
    for (let i = 0; i < depth; i++) {
      expected = { x: expected };
    }
    expect(resolve(state)).toEqual(expected);
  });
});

describe("edge cases — control characters", () => {
  test("all control characters U+0000 through U+001F are rejected in strings", () => {
    for (let code = 0x00; code <= 0x1f; code++) {
      const ch = String.fromCharCode(code);
      let state = create();
      state = push(state, '"a' + ch + 'b"');
      expect(state.error).not.toBeNull();
    }
  });

  test("character U+0020 (space) is allowed in strings", () => {
    let state = create();
    state = push(state, '"a b"');
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toBe("a b");
  });
});

describe("edge cases — string values", () => {
  test("empty string value", () => {
    let state = create();
    state = push(state, '""');
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toBe("");
  });

  test("string with all JSON escape sequences", () => {
    // All 8 standard JSON escape sequences in one string
    const json = '"\\"\\\\\\/\\b\\f\\n\\r\\t"';
    let state = create();
    state = push(state, json);
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toBe('"\\/\b\f\n\r\t');
  });

  test("unicode escape for non-ASCII (\\u00E9 → é)", () => {
    let state = create();
    state = push(state, '"\\u00E9"');
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toBe("\u00E9");
  });

  test("unicode escape \\u00e9 lowercase is valid", () => {
    let state = create();
    state = push(state, '"\\u00e9"');
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toBe("é");
  });

  test("unicode escape \\u0000 is VALID in escape form (not a bare control char)", () => {
    let state = create();
    state = push(state, '"\\u0000"');
    state = finish(state);
    // \\u0000 as escape sequence is valid JSON — it produces a null character in the string
    expect(state.error).toBeNull();
    expect(resolve(state)).toBe("\u0000");
  });

  test("string with unicode escapes for ASCII letters", () => {
    let state = create();
    state = push(state, '"\\u0041\\u0042\\u0043"');
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toBe("ABC");
  });
});

describe("edge cases — numbers", () => {
  test("MAX_SAFE_INTEGER", () => {
    const n = Number.MAX_SAFE_INTEGER;
    let state = create();
    state = push(state, String(n));
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toBe(n);
  });

  test("very large exponent 1e308", () => {
    let state = create();
    state = push(state, "1e308");
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toBe(1e308);
  });

  test("zero", () => {
    let state = create();
    state = push(state, "0");
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toBe(0);
  });

  test("negative zero", () => {
    let state = create();
    state = push(state, "-0");
    state = finish(state);
    expect(state.error).toBeNull();
    // -0 in JS: use Object.is to distinguish from 0
    expect(Object.is(resolve(state), -0)).toBe(true);
  });
});

describe("edge cases — object keys", () => {
  test("object with escaped key (hello\\nworld)", () => {
    let state = create();
    state = push(state, '{"hello\\nworld": 1}');
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toEqual({ "hello\nworld": 1 });
  });

  test("object with unicode-escaped key", () => {
    let state = create();
    state = push(state, '{"\\u0041": 1}');
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toEqual({ A: 1 });
  });
});

describe("edge cases — nested empty containers", () => {
  test("[[], {}, [{}], {a: []}]", () => {
    let state = create();
    state = push(state, '[[], {}, [{}], {"a": []}]');
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toEqual([[], {}, [{}], { a: [] }]);
  });

  test("deeply nested empty object", () => {
    let state = create();
    state = push(state, '{"a": {"b": {"c": {}}}}');
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toEqual({ a: { b: { c: {} } } });
  });

  test("deeply nested empty array", () => {
    let state = create();
    state = push(state, "[[[[]]]]");
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toEqual([[[[]]]] );
  });

  test("empty array", () => {
    let state = create();
    state = push(state, "[]");
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toEqual([]);
  });

  test("empty object", () => {
    let state = create();
    state = push(state, "{}");
    state = finish(state);
    expect(state.error).toBeNull();
    expect(resolve(state)).toEqual({});
  });
});
