import { describe, expect, test } from "vitest";
import { create, push, finish } from "../index";

describe("errors — trailing token after root value", () => {
  test("true followed by false", () => {
    let state = create();
    state = push(state, "true false");
    expect(state.error).not.toBeNull();
  });

  test("two integers", () => {
    let state = create();
    state = push(state, "1 2");
    expect(state.error).not.toBeNull();
  });

  test("null followed by another null", () => {
    let state = create();
    state = push(state, "null null");
    expect(state.error).not.toBeNull();
  });
});

describe("errors — invalid escape sequences", () => {
  test("invalid escape \\x", () => {
    let state = create();
    state = push(state, '"\\x"');
    expect(state.error).not.toBeNull();
    expect(state.error!.message).toContain("\\x");
  });

  test("invalid escape \\a", () => {
    let state = create();
    state = push(state, '"\\a"');
    expect(state.error).not.toBeNull();
  });

  test("invalid escape \\p", () => {
    let state = create();
    state = push(state, '"\\p"');
    expect(state.error).not.toBeNull();
  });
});

describe("errors — invalid unicode escapes", () => {
  test("invalid unicode \\uZZZZ", () => {
    let state = create();
    state = push(state, '"\\uZZZZ"');
    expect(state.error).not.toBeNull();
    expect(state.error!.message).toContain("hex digit");
  });

  test("invalid unicode \\uGGGG", () => {
    let state = create();
    state = push(state, '"\\uGGGG"');
    expect(state.error).not.toBeNull();
  });

  test("invalid unicode \\u00GG is rejected", () => {
    let state = create();
    state = push(state, '"\\u00GG"');
    expect(state.error).not.toBeNull();
    expect(state.error!.message).toContain("hex digit");
  });
});

describe("errors — control characters in strings", () => {
  test("tab character (U+0009) in string body", () => {
    let state = create();
    state = push(state, '"a\tb"');
    expect(state.error).not.toBeNull();
    expect(state.error!.message).toContain("U+0009");
    expect(state.error!.message).toContain("TAB");
  });

  test("null byte (U+0000) in string body", () => {
    let state = create();
    state = push(state, '"a\0b"');
    expect(state.error).not.toBeNull();
    expect(state.error!.message).toContain("U+0000");
  });

  test("newline (U+000A) in string body", () => {
    let state = create();
    state = push(state, '"line1\nline2"');
    expect(state.error).not.toBeNull();
    expect(state.error!.message).toContain("U+000A");
  });

  test("carriage return (U+000D) in string body", () => {
    let state = create();
    state = push(state, '"a\rb"');
    expect(state.error).not.toBeNull();
    expect(state.error!.message).toContain("U+000D");
  });
});

describe("errors — object structure", () => {
  test("missing colon in object", () => {
    let state = create();
    state = push(state, '{"a" 1}');
    expect(state.error).not.toBeNull();
  });

  test("missing comma in object", () => {
    let state = create();
    state = push(state, '{"a": 1 "b": 2}');
    expect(state.error).not.toBeNull();
  });

  test("trailing comma in object", () => {
    let state = create();
    state = push(state, '{"a": 1,}');
    expect(state.error).not.toBeNull();
    expect(state.error!.message).toContain("Trailing comma");
  });
});

describe("errors — array structure", () => {
  test("missing comma in array", () => {
    let state = create();
    state = push(state, "[1 2]");
    expect(state.error).not.toBeNull();
  });

  test("trailing comma in array", () => {
    let state = create();
    state = push(state, "[1,]");
    expect(state.error).not.toBeNull();
  });
});

describe("errors — unexpected EOF", () => {
  test("unclosed array", () => {
    let state = create();
    state = push(state, "[1, 2");
    state = finish(state);
    expect(state.error).not.toBeNull();
  });

  test("unclosed object", () => {
    let state = create();
    state = push(state, '{"a": 1');
    state = finish(state);
    expect(state.error).not.toBeNull();
  });

  test("unclosed string", () => {
    let state = create();
    state = push(state, '"hello');
    state = finish(state);
    expect(state.error).not.toBeNull();
  });

  test("empty input", () => {
    let state = create();
    state = finish(state);
    expect(state.error).not.toBeNull();
  });

  test("whitespace-only input", () => {
    let state = create();
    state = push(state, "   \n\t  ");
    state = finish(state);
    expect(state.error).not.toBeNull();
  });
});

describe("errors — location information", () => {
  test("error includes line and column (multi-line input)", () => {
    let state = create();
    // Error is on the second line
    state = push(state, '{\n  "a": X\n}');
    expect(state.error).not.toBeNull();
    expect(state.error!.line).toBeGreaterThan(1);
    expect(state.error!.column).toBeGreaterThan(0);
  });

  test("error index points to offending character", () => {
    let state = create();
    // 'X' is the 9th character (index 8, 0-based)
    state = push(state, '{"a": X}');
    expect(state.error).not.toBeNull();
    // Index should be at the position of 'X' (index 6, 0-based)
    expect(state.error!.index).toBeGreaterThan(0);
  });

  test("error on first character has column 1", () => {
    let state = create();
    state = push(state, "X");
    expect(state.error).not.toBeNull();
    expect(state.error!.line).toBe(1);
  });
});

describe("errors — subsequent push after error", () => {
  test("subsequent push after error returns same state object (identity)", () => {
    let state = create();
    state = push(state, "INVALID");
    const errorState = state;
    expect(errorState.error).not.toBeNull();

    // Push more data after error — should return same state
    const afterPush = push(state, " more data");
    expect(afterPush).toBe(errorState);
  });

  test("finish after error returns same state object (identity)", () => {
    let state = create();
    state = push(state, "INVALID");
    const errorState = state;

    const afterFinish = finish(state);
    expect(afterFinish).toBe(errorState);
  });

  test("multiple pushes after error all return same reference", () => {
    let state = create();
    state = push(state, "BAD");
    const errorState = state;

    const s1 = push(state, "a");
    const s2 = push(s1, "b");
    const s3 = push(s2, "c");
    expect(s1).toBe(errorState);
    expect(s2).toBe(errorState);
    expect(s3).toBe(errorState);
  });
});

describe("errors — invalid literal partial match", () => {
  test("tru! (invalid literal)", () => {
    let state = create();
    state = push(state, "tru!");
    expect(state.error).not.toBeNull();
  });

  test("nul! (invalid literal)", () => {
    let state = create();
    state = push(state, "nul!");
    expect(state.error).not.toBeNull();
  });

  test("fals! (invalid literal)", () => {
    let state = create();
    state = push(state, "fals!");
    expect(state.error).not.toBeNull();
  });

  test("tr (incomplete literal at finish)", () => {
    let state = create();
    state = push(state, "tr");
    state = finish(state);
    expect(state.error).not.toBeNull();
  });
});

describe("errors — mismatched brackets", () => {
  test("[} mismatch", () => {
    let state = create();
    state = push(state, "[}");
    expect(state.error).not.toBeNull();
  });

  test("{] mismatch", () => {
    let state = create();
    state = push(state, '{"a": 1]');
    expect(state.error).not.toBeNull();
  });

  test("[1, 2} mismatch", () => {
    let state = create();
    state = push(state, "[1, 2}");
    expect(state.error).not.toBeNull();
  });
});

describe("errors — multiple root values", () => {
  test("1 2 (two numbers)", () => {
    let state = create();
    state = push(state, "1 2");
    expect(state.error).not.toBeNull();
  });

  test("true false (two literals)", () => {
    let state = create();
    state = push(state, "true false");
    expect(state.error).not.toBeNull();
  });

  test("[] [] (two arrays)", () => {
    let state = create();
    state = push(state, "[] []");
    expect(state.error).not.toBeNull();
  });
});
