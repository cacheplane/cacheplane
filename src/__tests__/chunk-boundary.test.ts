import { describe, expect, test } from "vitest";
import { create, push, finish, resolve } from "../index";

// Helper: feed chunks one at a time and return final resolved value
function parseChunks(chunks: string[]): unknown {
  let state = create();
  for (const chunk of chunks) {
    state = push(state, chunk);
  }
  state = finish(state);
  expect(state.error).toBeNull();
  return resolve(state);
}

describe("chunk boundary — strings", () => {
  test("string split mid-content", () => {
    const result = parseChunks(['"hel', 'lo"']);
    expect(result).toBe("hello");
  });

  test("string split at every position", () => {
    const json = '"abcdef"';
    for (let i = 1; i < json.length; i++) {
      const result = parseChunks([json.slice(0, i), json.slice(i)]);
      expect(result).toBe("abcdef");
    }
  });

  test("string split mid-escape (backslash at chunk boundary)", () => {
    // '\' at end of chunk, 'n' at start of next
    const result = parseChunks(['"a\\', 'nb"']);
    expect(result).toBe("a\nb");
  });

  test("string split mid-escape at quote", () => {
    const result = parseChunks(['"say \\"', 'hi\\""']);
    expect(result).toBe('say "hi"');
  });

  test("string with escape split across chunks — backslash", () => {
    const result = parseChunks(['"path\\\\', 'to"']);
    expect(result).toBe("path\\to");
  });

  test("unicode escape split at every position", () => {
    // \\u0041 = 'A'
    const escapeSeq = '"\\u0041"';
    for (let i = 1; i < escapeSeq.length; i++) {
      const result = parseChunks([escapeSeq.slice(0, i), escapeSeq.slice(i)]);
      expect(result).toBe("A");
    }
  });

  test("unicode escape split mid-digits (\\u00 + 41)", () => {
    const result = parseChunks(['"\\u00', '41"']);
    expect(result).toBe("A");
  });

  test("unicode escape split after \\u (only backslash+u sent)", () => {
    const result = parseChunks(['"\\u', '0041"']);
    expect(result).toBe("A");
  });

  test("unicode escape split one digit at a time", () => {
    const result = parseChunks(['"', "\\", "u", "0", "0", "4", "1", '"']);
    expect(result).toBe("A");
  });
});

describe("chunk boundary — literals", () => {
  test("false split f-a-l-s-e", () => {
    const result = parseChunks(["f", "a", "l", "s", "e"]);
    expect(result).toBe(false);
  });

  test("false split fa-lse", () => {
    const result = parseChunks(["fa", "lse"]);
    expect(result).toBe(false);
  });

  test("false split fals-e", () => {
    const result = parseChunks(["fals", "e"]);
    expect(result).toBe(false);
  });

  test("null split n-u-l-l", () => {
    const result = parseChunks(["n", "u", "l", "l"]);
    expect(result).toBeNull();
  });

  test("null split nu-ll", () => {
    const result = parseChunks(["nu", "ll"]);
    expect(result).toBeNull();
  });

  test("null split nul-l", () => {
    const result = parseChunks(["nul", "l"]);
    expect(result).toBeNull();
  });

  test("false at every split position", () => {
    const json = "false";
    for (let i = 1; i < json.length; i++) {
      const result = parseChunks([json.slice(0, i), json.slice(i)]);
      expect(result).toBe(false);
    }
  });

  test("null at every split position", () => {
    const json = "null";
    for (let i = 1; i < json.length; i++) {
      const result = parseChunks([json.slice(0, i), json.slice(i)]);
      expect(result).toBeNull();
    }
  });
});

describe("chunk boundary — numbers", () => {
  test("number exponent boundary (1e + +10)", () => {
    const result = parseChunks(["1e", "+10"]);
    expect(result).toBe(1e10);
  });

  test("number split at decimal", () => {
    const result = parseChunks(["1.", "5"]);
    expect(result).toBe(1.5);
  });

  test("number split at every position", () => {
    const json = "123.456e10";
    for (let i = 1; i < json.length; i++) {
      // Wrap in array so the number is terminated by ']'
      const result = parseChunks(["[" + json.slice(0, i), json.slice(i) + "]"]);
      expect(result).toEqual([123.456e10]);
    }
  });

  test("negative number split after minus", () => {
    const result = parseChunks(["-", "42"]);
    expect(result).toBe(-42);
  });
});

describe("chunk boundary — objects", () => {
  test("object key with escape across chunks", () => {
    const result = parseChunks(['{"hello\\', 'nworld": 1}']);
    expect(result).toEqual({ "hello\nworld": 1 });
  });

  test("object key split mid-content", () => {
    const result = parseChunks(['{"hel', 'lo": 42}']);
    expect(result).toEqual({ hello: 42 });
  });

  test("object split at colon", () => {
    const result = parseChunks(['{"a"', ": 1}"]);
    expect(result).toEqual({ a: 1 });
  });

  test("object split at comma", () => {
    const result = parseChunks(['{"a": 1', ', "b": 2}']);
    expect(result).toEqual({ a: 1, b: 2 });
  });
});

describe("chunk boundary — arrays", () => {
  test("deep nesting across boundaries ([[+[1]+]])", () => {
    const result = parseChunks(["[[", "[1]", "]]"]);
    expect(result).toEqual([[[1]]]);
  });

  test("array split at every position", () => {
    const json = "[1, 2, 3]";
    for (let i = 1; i < json.length; i++) {
      const result = parseChunks([json.slice(0, i), json.slice(i)]);
      expect(result).toEqual([1, 2, 3]);
    }
  });

  test("nested array split at every position", () => {
    const json = "[[1, 2], [3, 4]]";
    for (let i = 1; i < json.length; i++) {
      const result = parseChunks([json.slice(0, i), json.slice(i)]);
      expect(result).toEqual([
        [1, 2],
        [3, 4],
      ]);
    }
  });
});

describe("chunk boundary — single chunk equivalence", () => {
  test("complete JSON in single chunk gives same result as multi-chunk", () => {
    const json = '{"a": [1, "b", true, null, false]}';

    let single = create();
    single = push(single, json);
    single = finish(single);

    // Two chunks split in the middle
    const mid = Math.floor(json.length / 2);
    let multi = create();
    multi = push(multi, json.slice(0, mid));
    multi = push(multi, json.slice(mid));
    multi = finish(multi);

    expect(single.error).toBeNull();
    expect(multi.error).toBeNull();
    expect(resolve(single)).toEqual(resolve(multi));
  });

  test("character-by-character same as single chunk", () => {
    const json = '{"users": [{"name": "Alice"}, {"name": "Bob"}]}';

    let single = create();
    single = push(single, json);
    single = finish(single);

    let charByChar = create();
    for (const ch of json) {
      charByChar = push(charByChar, ch);
    }
    charByChar = finish(charByChar);

    expect(single.error).toBeNull();
    expect(charByChar.error).toBeNull();
    expect(resolve(single)).toEqual(resolve(charByChar));
  });
});
