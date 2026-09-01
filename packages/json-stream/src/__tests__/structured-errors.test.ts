// SPDX-License-Identifier: MIT
import { describe, expect, expectTypeOf, test } from "vitest";
import { create, finish, push } from "../index";
import type { StreamError, StreamErrorCode, StreamState } from "../index";

const invalidSyntaxCases = [
  ["unknown token", "X"],
  ["invalid escape", '"\\x"'],
  ["invalid unicode escape", '"\\u00GG"'],
  ["unescaped control character", '"line\nbreak"'],
  ["literal mismatch", "tru!"],
  ["unquoted object key", "{key:1}"],
  ["missing object colon", '{"key" 1}'],
  ["object closed with array delimiter", '{"key":1]'],
  ["array closed with object delimiter", "[1}"],
  ["missing array separator", "[1 2]"],
  ["missing object separator", '{"a":1 "b":2}'],
  ["array trailing comma", "[1,]"],
  ["object trailing comma", '{"a":1,}'],
  ["leading zero", "01"],
  ["leading plus", "+1"],
  ["invalid decimal grammar", "1.x"],
  ["invalid exponent grammar", "1eX"],
] as const;

const incompleteInputCases = [
  ["empty input", ""],
  ["whitespace-only input", " \n\t"],
  ["open array", "[1"],
  ["open object", '{"a":1'],
  ["incomplete object key", '{"key'],
  ["missing colon after object key", '{"key"'],
  ["missing object value", '{"key":'],
  ["missing array value", "[1,"],
  ["incomplete literal", "tru"],
  ["incomplete string", '"unterminated'],
] as const;

const incompleteNumberPrefixCases = [
  "-",
  "1.",
  "-1.",
  "0e",
  "1e",
  "-1E",
  "1e+",
  "1e-",
  "-1E+",
  "-1E-",
] as const;

const malformedNumberAtFinishCases = ["-.", "-e", "-e+"] as const;

const trailingContentCases = [
  ["two literals in one chunk", ["true false"]],
  ["literal followed immediately by a token", ["nullx"]],
  ["two containers", ["[]{}"]],
  ["object followed by a string", ['{}"next"']],
  ["content in a later chunk", ["{}", "null"]],
  ["number terminated before later content", ["1 ", "2"]],
] as const;

function pushChunks(chunks: readonly string[]): StreamState {
  let state = create();
  for (const chunk of chunks) state = push(state, chunk);
  return state;
}

describe("structured stream error codes", () => {
  test("exports the complete public error-code union", () => {
    expectTypeOf<StreamErrorCode>().toEqualTypeOf<
      "INVALID_SYNTAX" | "UNEXPECTED_END" | "TRAILING_CONTENT"
    >();
    expectTypeOf<StreamError["code"]>().toEqualTypeOf<StreamErrorCode>();
  });

  test.each(invalidSyntaxCases)(
    "classifies %s as invalid syntax",
    (_label, input) => {
      const state = push(create(), input);

      expect(state.error?.code).toBe("INVALID_SYNTAX");
    },
  );

  test.each(malformedNumberAtFinishCases)(
    "classifies the malformed terminal number %j as invalid syntax",
    (input) => {
      const state = finish(push(create(), input));

      expect(state.error?.code).toBe("INVALID_SYNTAX");
    },
  );

  test.each(incompleteInputCases)(
    "classifies %s as an unexpected end",
    (_label, input) => {
      const state = finish(push(create(), input));

      expect(state.error?.code).toBe("UNEXPECTED_END");
    },
  );

  test.each(incompleteNumberPrefixCases)(
    "classifies the incomplete number prefix %j as an unexpected end",
    (input) => {
      const state = finish(push(create(), input));

      expect(state.error?.code).toBe("UNEXPECTED_END");
    },
  );

  test.each(trailingContentCases)(
    "classifies %s as trailing content",
    (_label, chunks) => {
      const state = pushChunks(chunks);

      expect(state.error?.code).toBe("TRAILING_CONTENT");
    },
  );

  test.each([
    ["INVALID_SYNTAX", () => push(create(), '"\\x"')],
    ["UNEXPECTED_END", () => finish(push(create(), "1e+"))],
    ["TRAILING_CONTENT", () => push(create(), "[] trailing")],
  ] as const)(
    "preserves terminal %s state and error identity after later operations",
    (code, createErrorState) => {
      const errorState = createErrorState();
      const error = errorState.error;

      expect(error?.code).toBe(code);

      const pushed = push(errorState, " ignored");
      const finished = finish(errorState);

      expect(pushed).toBe(errorState);
      expect(finished).toBe(errorState);
      expect(pushed.error).toBe(error);
      expect(finished.error).toBe(error);
      expect(pushed.error?.code).toBe(code);
      expect(finished.error?.code).toBe(code);
    },
  );
});
