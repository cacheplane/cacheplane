import type { InternalState } from "./types";
import {
  handleValue,
  handleStringValue,
  handleNumberValue,
  handleLiteralValue,
  handleArrayItemOrEnd,
  handleObjectKeyOrEnd,
  handleObjectKey,
  handleObjectColon,
  handleSeparator,
  handleDone,
} from "./handlers";

export function pushInternal(
  state: InternalState,
  chunk: string,
): InternalState {
  if (state.error) return state;

  let s = state;
  let pos = 0;

  while (pos < chunk.length) {
    if (s.error) break;

    const ch = chunk[pos];
    const prevMode = s.mode;
    const prevIndex = s.index;
    let result: { state: InternalState; pos: number };

    switch (s.mode) {
      case "Value":
        result = handleValue(s, ch);
        break;
      case "StringValue":
        result = handleStringValue(s, ch);
        break;
      case "NumberValue":
        result = handleNumberValue(s, ch);
        break;
      case "LiteralValue":
        result = handleLiteralValue(s, ch);
        break;
      case "ArrayItemOrEnd":
        result = handleArrayItemOrEnd(s, ch);
        break;
      case "ObjectKeyOrEnd":
        result = handleObjectKeyOrEnd(s, ch);
        break;
      case "ObjectKey":
        result = handleObjectKey(s, ch);
        break;
      case "ObjectColon":
        result = handleObjectColon(s, ch);
        break;
      case "Separator":
        result = handleSeparator(s, ch);
        break;
      case "Done":
        result = handleDone(s, ch);
        break;
      case "Error":
        return s;
    }

    s = result.state;

    // Compute how many characters were consumed by checking how much state.index advanced.
    // Handlers return state.index (global position) as result.pos, but we need a chunk-local
    // offset. Use the delta in state.index to advance pos correctly.
    const consumed = s.index - prevIndex;

    if (consumed > 0) {
      // Handler consumed one or more characters — advance chunk-local position by the same amount.
      pos += consumed;
    } else if (s.error) {
      // Error set, stop
      break;
    } else if (s.mode === prevMode) {
      // No progress, no mode change — prevent infinite loop
      break;
    }
    // Otherwise: handler didn't consume but changed mode — re-process same char
  }

  return s;
}
