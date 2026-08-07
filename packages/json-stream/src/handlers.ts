import type { InternalState } from "./types";
import {
  advancePosition,
  afterValue,
  appendStringFragment,
  closeContainer,
  closePrimitive,
  openNode,
  toErrorState,
  NUMBER_RE,
} from "./internals";

// ---- Value handler ----

export function handleValue(
  state: InternalState,
  ch: string,
): { state: InternalState; pos: number } {
  // Skip whitespace
  if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
    return { state: advancePosition(state, ch), pos: state.index + 1 };
  }

  if (ch === '"') {
    // Open a string node
    const { state: s1, nodeId } = openNode(state, "string");
    if (s1.error) return { state: s1, pos: s1.index };
    const s2 = advancePosition(s1, ch);
    return {
      state: {
        ...s2,
        mode: "StringValue",
        stringContext: "value",
        currentNodeId: nodeId,
      },
      pos: s2.index,
    };
  }

  if (ch === "-" || (ch >= "0" && ch <= "9")) {
    const { state: s1, nodeId } = openNode(state, "number");
    if (s1.error) return { state: s1, pos: s1.index };
    // Buffer the first char and update the node's buffer
    const node = s1.nodes[nodeId];
    const updatedNode = { ...node, buffer: ch } as typeof node;
    const nodes = s1.nodes.slice();
    nodes[nodeId] = updatedNode;
    const s2 = advancePosition({ ...s1, nodes }, ch);
    return {
      state: {
        ...s2,
        mode: "NumberValue",
        currentNodeId: nodeId,
      },
      pos: s2.index,
    };
  }

  if (ch === "t") {
    const { state: s1, nodeId } = openNode(state, "boolean");
    if (s1.error) return { state: s1, pos: s1.index };
    const s2 = advancePosition(s1, ch);
    return {
      state: {
        ...s2,
        mode: "LiteralValue",
        literalExpected: "rue",
        literalBuffer: "t",
        currentNodeId: nodeId,
      },
      pos: s2.index,
    };
  }

  if (ch === "f") {
    const { state: s1, nodeId } = openNode(state, "boolean");
    if (s1.error) return { state: s1, pos: s1.index };
    const s2 = advancePosition(s1, ch);
    return {
      state: {
        ...s2,
        mode: "LiteralValue",
        literalExpected: "alse",
        literalBuffer: "f",
        currentNodeId: nodeId,
      },
      pos: s2.index,
    };
  }

  if (ch === "n") {
    const { state: s1, nodeId } = openNode(state, "null");
    if (s1.error) return { state: s1, pos: s1.index };
    const s2 = advancePosition(s1, ch);
    return {
      state: {
        ...s2,
        mode: "LiteralValue",
        literalExpected: "ull",
        literalBuffer: "n",
        currentNodeId: nodeId,
      },
      pos: s2.index,
    };
  }

  if (ch === "[") {
    const { state: s1, nodeId } = openNode(state, "array");
    if (s1.error) return { state: s1, pos: s1.index };
    const s2 = advancePosition(s1, ch);
    return {
      state: {
        ...s2,
        mode: "ArrayItemOrEnd",
        currentNodeId: nodeId,
      },
      pos: s2.index,
    };
  }

  if (ch === "{") {
    const { state: s1, nodeId } = openNode(state, "object");
    if (s1.error) return { state: s1, pos: s1.index };
    const s2 = advancePosition(s1, ch);
    return {
      state: {
        ...s2,
        mode: "ObjectKeyOrEnd",
        currentNodeId: nodeId,
      },
      pos: s2.index,
    };
  }

  // Unknown character
  const code = ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
  return {
    state: toErrorState(state, `Unexpected token U+${code}`),
    pos: state.index,
  };
}

// ---- StringValue handler ----

const ESCAPE_MAP: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

const CONTROL_NAMES: Record<number, string> = {
  0: "NULL",
  1: "SOH",
  2: "STX",
  3: "ETX",
  4: "EOT",
  5: "ENQ",
  6: "ACK",
  7: "BEL",
  8: "BS",
  9: "TAB",
  10: "LF",
  11: "VT",
  12: "FF",
  13: "CR",
  14: "SO",
  15: "SI",
  16: "DLE",
  17: "DC1",
  18: "DC2",
  19: "DC3",
  20: "DC4",
  21: "NAK",
  22: "SYN",
  23: "ETB",
  24: "CAN",
  25: "EM",
  26: "SUB",
  27: "ESC",
  28: "FS",
  29: "GS",
  30: "RS",
  31: "US",
};

function isHexDigit(ch: string): boolean {
  return (
    (ch >= "0" && ch <= "9") ||
    (ch >= "a" && ch <= "f") ||
    (ch >= "A" && ch <= "F")
  );
}

export function handleStringValue(
  state: InternalState,
  ch: string,
): { state: InternalState; pos: number } {
  // Unicode escape accumulation
  if (state.stringUnicode !== null) {
    if (!isHexDigit(ch)) {
      return {
        state: toErrorState(
          state,
          `Invalid unicode escape: expected hex digit, got '${ch}'`,
        ),
        pos: state.index,
      };
    }
    const hexDigits = state.stringUnicode + ch;
    const s1 = advancePosition(state, ch);
    if (hexDigits.length < 4) {
      return { state: { ...s1, stringUnicode: hexDigits }, pos: s1.index };
    }
    // We have 4 valid hex digits
    const codePoint = parseInt(hexDigits, 16);
    const char = String.fromCharCode(codePoint);
    const s2 = appendStringFragment({ ...s1, stringUnicode: null }, char);
    return { state: s2, pos: s2.index };
  }

  // Escape sequence
  if (state.stringEscape) {
    const s1 = advancePosition({ ...state, stringEscape: false }, ch);
    if (ch === "u") {
      return { state: { ...s1, stringUnicode: "" }, pos: s1.index };
    }
    const mapped = ESCAPE_MAP[ch];
    if (mapped === undefined) {
      return {
        state: toErrorState(s1, `Invalid escape sequence \\${ch}`),
        pos: s1.index,
      };
    }
    const s2 = appendStringFragment(s1, mapped);
    return { state: s2, pos: s2.index };
  }

  // Start escape
  if (ch === "\\") {
    const s1 = advancePosition({ ...state, stringEscape: true }, ch);
    return { state: s1, pos: s1.index };
  }

  // End of string
  if (ch === '"') {
    const s1 = advancePosition(state, ch);
    if (state.stringContext === "key") {
      // Store key, transition to ObjectColon
      const keyBuffer = state.keyBuffer;
      const parentId = state.stack[state.stack.length - 1];
      return {
        state: {
          ...s1,
          mode: "ObjectColon",
          stringContext: null,
          keyBuffer: "",
          pendingKey: keyBuffer,
          pendingKeyOwner: parentId,
        },
        pos: s1.index,
      };
    }
    // Value context: close primitive
    const nodeId = state.currentNodeId!;
    const node = state.nodes[nodeId];
    const value = (node as { buffer: string }).buffer ?? "";
    const s2 = closePrimitive(s1, nodeId, value);
    const { mode, complete } = afterValue(s2.stack);
    return {
      state: {
        ...s2,
        mode,
        complete,
        stringContext: null,
      },
      pos: s2.index,
    };
  }

  // Control character check (< 0x20)
  const code = ch.charCodeAt(0);
  if (code < 0x20) {
    const hex = code.toString(16).toUpperCase().padStart(4, "0");
    const name = CONTROL_NAMES[code] ?? "CONTROL";
    return {
      state: toErrorState(
        state,
        `Invalid control character U+${hex} (${name}) in string`,
      ),
      pos: state.index,
    };
  }

  // Normal character
  const s1 = advancePosition(state, ch);
  const s2 = appendStringFragment(s1, ch);
  return { state: s2, pos: s2.index };
}

// ---- NumberValue handler ----

export function handleNumberValue(
  state: InternalState,
  ch: string,
): { state: InternalState; pos: number } {
  const nodeId = state.currentNodeId!;
  const node = state.nodes[nodeId] as { buffer: string; kind: string };
  const buf = node.buffer;

  const isDigit = (c: string) => c >= "0" && c <= "9";
  const lastChar = buf[buf.length - 1];

  // Determine what phase we're in based on buffer contents
  const hasDecimalDot = buf.includes(".");
  const hasExp = buf.includes("e") || buf.includes("E");

  // Check for leading zero issues early
  if (buf === "0" || buf === "-0") {
    // After a sole zero (possibly with minus), only `.`, `e/E` are allowed; digits are rejected
    if (isDigit(ch)) {
      return {
        state: toErrorState(
          state,
          `Invalid number: leading zero in "${buf}${ch}"`,
        ),
        pos: state.index,
      };
    }
  }

  // After dot: next must be digit
  if (lastChar === ".") {
    if (!isDigit(ch)) {
      return {
        state: toErrorState(
          state,
          `Invalid number: expected digit after decimal point in "${buf}"`,
        ),
        pos: state.index,
      };
    }
  }

  // After e/E: next must be digit or +/-
  if (lastChar === "e" || lastChar === "E") {
    if (!isDigit(ch) && ch !== "+" && ch !== "-") {
      return {
        state: toErrorState(
          state,
          `Invalid number: expected digit or sign after exponent in "${buf}"`,
        ),
        pos: state.index,
      };
    }
  }

  // After +/- (exponent sign): digit required
  if ((lastChar === "+" || lastChar === "-") && buf.length > 1) {
    if (!isDigit(ch)) {
      return {
        state: toErrorState(
          state,
          `Invalid number: expected digit after exponent sign in "${buf}"`,
        ),
        pos: state.index,
      };
    }
  }

  // Is this char part of a number?
  const isNumberChar =
    isDigit(ch) ||
    (ch === "." && !hasDecimalDot && !hasExp) ||
    ((ch === "e" || ch === "E") && !hasExp) ||
    ((ch === "+" || ch === "-") && (lastChar === "e" || lastChar === "E"));

  if (isNumberChar) {
    // Append to buffer
    const updatedNode = { ...node, buffer: buf + ch } as typeof node & {
      buffer: string;
    };
    const nodes = state.nodes.slice();
    nodes[nodeId] = updatedNode as (typeof state.nodes)[number];
    const s1 = advancePosition({ ...state, nodes }, ch);
    return { state: s1, pos: s1.index };
  }

  // Terminating character: validate and close
  if (!NUMBER_RE.test(buf)) {
    return {
      state: toErrorState(state, `Invalid number: "${buf}"`),
      pos: state.index,
    };
  }

  const value = parseFloat(buf);
  const s1 = closePrimitive(state, nodeId, value);
  const { mode, complete } = afterValue(s1.stack);
  // Do NOT advance pos — the terminating char will be re-processed
  return {
    state: { ...s1, mode, complete },
    pos: state.index,
  };
}

// ---- LiteralValue handler ----

export function handleLiteralValue(
  state: InternalState,
  ch: string,
): { state: InternalState; pos: number } {
  const expected = state.literalExpected!;
  const nodeId = state.currentNodeId!;

  if (expected.length === 0) {
    // Fully matched — but we got another char; the literal is done, treat as termination
    // This shouldn't normally happen if we close on completion, but handle it gracefully
    // by finalizing and NOT consuming the char
    const buf = state.literalBuffer;
    let value: null | boolean;
    if (buf === "true") value = true;
    else if (buf === "false") value = false;
    else value = null;
    const s1 = closePrimitive(state, nodeId, value);
    const { mode, complete } = afterValue(s1.stack);
    return {
      state: {
        ...s1,
        mode,
        complete,
        literalExpected: null,
        literalBuffer: "",
      },
      pos: state.index,
    };
  }

  if (ch !== expected[0]) {
    return {
      state: toErrorState(
        state,
        `Unexpected character '${ch}' while parsing literal`,
      ),
      pos: state.index,
    };
  }

  const remaining = expected.slice(1);
  const newBuffer = state.literalBuffer + ch;
  const s1 = advancePosition(state, ch);

  if (remaining.length === 0) {
    // Literal complete
    let value: null | boolean;
    if (newBuffer === "true") value = true;
    else if (newBuffer === "false") value = false;
    else value = null;
    const s2 = closePrimitive(
      { ...s1, literalExpected: null, literalBuffer: "" },
      nodeId,
      value,
    );
    const { mode, complete } = afterValue(s2.stack);
    return { state: { ...s2, mode, complete }, pos: s2.index };
  }

  return {
    state: { ...s1, literalExpected: remaining, literalBuffer: newBuffer },
    pos: s1.index,
  };
}

// ---- ArrayItemOrEnd handler ----

export function handleArrayItemOrEnd(
  state: InternalState,
  ch: string,
): { state: InternalState; pos: number } {
  // Skip whitespace
  if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
    return { state: advancePosition(state, ch), pos: state.index + 1 };
  }

  if (ch === "]") {
    const nodeId = state.stack[state.stack.length - 1];
    const s1 = closeContainer(state, nodeId);
    const stack = s1.stack.slice(0, -1);
    const s2 = advancePosition({ ...s1, stack }, ch);
    const { mode, complete } = afterValue(stack);
    return { state: { ...s2, mode, complete }, pos: s2.index };
  }

  // Else: delegate to Value mode (don't consume char)
  return { state: { ...state, mode: "Value" }, pos: state.index };
}

// ---- ObjectKeyOrEnd handler (allows `}`) ----

export function handleObjectKeyOrEnd(
  state: InternalState,
  ch: string,
): { state: InternalState; pos: number } {
  // Skip whitespace
  if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
    return { state: advancePosition(state, ch), pos: state.index + 1 };
  }

  if (ch === "}") {
    const nodeId = state.stack[state.stack.length - 1];
    const s1 = closeContainer(state, nodeId);
    const stack = s1.stack.slice(0, -1);
    const s2 = advancePosition({ ...s1, stack }, ch);
    const { mode, complete } = afterValue(stack);
    return { state: { ...s2, mode, complete }, pos: s2.index };
  }

  if (ch === '"') {
    const s1 = advancePosition(state, ch);
    return {
      state: {
        ...s1,
        mode: "StringValue",
        stringContext: "key",
        keyBuffer: "",
      },
      pos: s1.index,
    };
  }

  return {
    state: toErrorState(state, `Expected string key or '}', got '${ch}'`),
    pos: state.index,
  };
}

// ---- ObjectKey handler (does NOT allow `}`, for after commas) ----

export function handleObjectKey(
  state: InternalState,
  ch: string,
): { state: InternalState; pos: number } {
  // Skip whitespace
  if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
    return { state: advancePosition(state, ch), pos: state.index + 1 };
  }

  if (ch === "}") {
    return {
      state: toErrorState(state, "Trailing comma in object"),
      pos: state.index,
    };
  }

  if (ch === '"') {
    const s1 = advancePosition(state, ch);
    return {
      state: {
        ...s1,
        mode: "StringValue",
        stringContext: "key",
        keyBuffer: "",
      },
      pos: s1.index,
    };
  }

  return {
    state: toErrorState(state, `Expected string key, got '${ch}'`),
    pos: state.index,
  };
}

// ---- ObjectColon handler ----

export function handleObjectColon(
  state: InternalState,
  ch: string,
): { state: InternalState; pos: number } {
  // Skip whitespace
  if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
    return { state: advancePosition(state, ch), pos: state.index + 1 };
  }

  if (ch === ":") {
    const s1 = advancePosition(state, ch);
    return { state: { ...s1, mode: "Value" }, pos: s1.index };
  }

  return {
    state: toErrorState(state, `Expected ':', got '${ch}'`),
    pos: state.index,
  };
}

// ---- Separator handler ----

export function handleSeparator(
  state: InternalState,
  ch: string,
): { state: InternalState; pos: number } {
  // Skip whitespace
  if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
    return { state: advancePosition(state, ch), pos: state.index + 1 };
  }

  if (ch === ",") {
    const s1 = advancePosition(state, ch);
    const parentId = s1.stack[s1.stack.length - 1];
    const parent = s1.nodes[parentId];
    if (parent.kind === "array") {
      return { state: { ...s1, mode: "Value" }, pos: s1.index };
    }
    if (parent.kind === "object") {
      // Use ObjectKey (not ObjectKeyOrEnd) to reject trailing commas
      return { state: { ...s1, mode: "ObjectKey" }, pos: s1.index };
    }
    return { state: toErrorState(s1, "Unexpected comma"), pos: s1.index };
  }

  if (ch === "]") {
    const parentId = state.stack[state.stack.length - 1];
    const parent = state.nodes[parentId];
    if (parent.kind !== "array") {
      return {
        state: toErrorState(state, `Expected '}' but got ']'`),
        pos: state.index,
      };
    }
    const s1 = closeContainer(state, parentId);
    const stack = s1.stack.slice(0, -1);
    const s2 = advancePosition({ ...s1, stack }, ch);
    const { mode, complete } = afterValue(stack);
    return { state: { ...s2, mode, complete }, pos: s2.index };
  }

  if (ch === "}") {
    const parentId = state.stack[state.stack.length - 1];
    const parent = state.nodes[parentId];
    if (parent.kind !== "object") {
      return {
        state: toErrorState(state, `Expected ']' but got '}'`),
        pos: state.index,
      };
    }
    const s1 = closeContainer(state, parentId);
    const stack = s1.stack.slice(0, -1);
    const s2 = advancePosition({ ...s1, stack }, ch);
    const { mode, complete } = afterValue(stack);
    return { state: { ...s2, mode, complete }, pos: s2.index };
  }

  return {
    state: toErrorState(
      state,
      `Unexpected character '${ch}' in separator position`,
    ),
    pos: state.index,
  };
}

// ---- Done handler ----

export function handleDone(
  state: InternalState,
  ch: string,
): { state: InternalState; pos: number } {
  if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
    return { state: advancePosition(state, ch), pos: state.index + 1 };
  }
  return {
    state: toErrorState(state, "Unexpected token after root value"),
    pos: state.index,
  };
}
