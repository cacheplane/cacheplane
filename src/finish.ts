import type { InternalState } from "./types";
import { closePrimitive, toErrorState, afterValue, NUMBER_RE } from "./internals";

export function finishInternal(state: InternalState): InternalState {
  if (state.error) return state;

  let s = state;

  // Loop until Done, Error, or no transition occurred.
  // This ensures that after closing a primitive inside a container (e.g. NumberValue →
  // Separator), we re-enter the switch and detect the unclosed container.
  while (s.mode !== "Done" && !s.error) {
    const prevMode = s.mode;

    switch (s.mode) {
      case "NumberValue": {
        const nodeId = s.currentNodeId!;
        const node = s.nodes[nodeId] as { buffer: string };
        const buf = node.buffer;
        if (!NUMBER_RE.test(buf)) {
          return toErrorState(s, `Invalid number at end of input: "${buf}"`);
        }
        const value = parseFloat(buf);
        const s1 = closePrimitive(s, nodeId, value);
        const { mode, complete } = afterValue(s1.stack);
        s = { ...s1, mode, complete };
        break;
      }

      case "LiteralValue":
        return toErrorState(s, "Unexpected end of input while parsing literal");

      case "StringValue":
        return toErrorState(s, "Unexpected end of input while parsing string");

      case "Value":
        if (s.rootId === null) {
          return toErrorState(s, "Unexpected end of input: no value");
        }
        return toErrorState(s, "Unexpected end of input");

      case "Separator":
      case "ArrayItemOrEnd":
      case "ObjectKeyOrEnd":
      case "ObjectKey":
      case "ObjectColon":
        return toErrorState(s, "Unexpected end of input: unclosed container");

      default:
        return toErrorState(s, "Unexpected end of input");
    }

    // If mode didn't change, we're stuck — avoid infinite loop
    if (s.mode === prevMode) break;
  }

  return s;
}
