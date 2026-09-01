// SPDX-License-Identifier: MIT
import { describe, expect, expectTypeOf, test } from "vitest";
import { create, finish, push } from "../index";
import type { StreamError, StreamErrorCode } from "../index";

describe("structured stream error codes", () => {
  test("exports the complete public error-code union", () => {
    expectTypeOf<StreamErrorCode>().toEqualTypeOf<
      "INVALID_SYNTAX" | "UNEXPECTED_END" | "TRAILING_CONTENT"
    >();
    expectTypeOf<StreamError["code"]>().toEqualTypeOf<StreamErrorCode>();
  });

  test.each(["X", '{"a" 1}', "[1,]"])(
    "classifies the grammar failure in %j as invalid syntax",
    (input) => {
      const state = push(create(), input);

      expect(state.error?.code).toBe("INVALID_SYNTAX");
    },
  );

  test.each(["-", "1.", "1e", "1e+"])(
    "classifies the completed malformed primitive %j as invalid syntax",
    (input) => {
      const state = finish(push(create(), input));

      expect(state.error?.code).toBe("INVALID_SYNTAX");
    },
  );

  test.each(["", "tru", '"unterminated', "[1", '{"a":'])(
    "classifies incomplete input %j as an unexpected end",
    (input) => {
      const state = finish(push(create(), input));

      expect(state.error?.code).toBe("UNEXPECTED_END");
    },
  );

  test.each(["true false", "1 2", "[]{}", '{}"next"'])(
    "classifies content after the completed root in %j as trailing content",
    (input) => {
      const state = push(create(), input);

      expect(state.error?.code).toBe("TRAILING_CONTENT");
    },
  );

  test("preserves the structured error and code after later operations", () => {
    const errorState = push(create(), "[] trailing");
    const error = errorState.error;

    expect(error?.code).toBe("TRAILING_CONTENT");

    const pushed = push(errorState, " ignored");
    const finished = finish(errorState);

    expect(pushed).toBe(errorState);
    expect(finished).toBe(errorState);
    expect(pushed.error).toBe(error);
    expect(finished.error).toBe(error);
    expect(pushed.error?.code).toBe("TRAILING_CONTENT");
    expect(finished.error?.code).toBe("TRAILING_CONTENT");
  });
});
