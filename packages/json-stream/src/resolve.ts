import type { JsonValue, StreamState } from "./types";

export function resolve(state: StreamState): JsonValue | undefined {
  if (state.rootId === null) return undefined;
  const root = state.nodes[state.rootId];
  if (!root) return undefined;
  return root.value as JsonValue | undefined;
}
