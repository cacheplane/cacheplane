import type {
  AstNode,
  ArrayNode,
  InternalState,
  JsonValue,
  ObjectNode,
  StreamError,
  StringNode,
} from "./types";

// Number validation regex: matches a valid JSON number string
export const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

// --- Node operations ---

export function replaceNode(
  nodes: AstNode[],
  id: number,
  node: AstNode,
): AstNode[] {
  if (nodes[id] === node) return nodes;
  const next = nodes.slice();
  next[id] = node;
  return next;
}

export function createStreamError(
  message: string,
  index: number,
  line: number,
  column: number,
): StreamError {
  return { message, index, line, column };
}

export function toErrorState(
  state: InternalState,
  message: string,
): InternalState {
  return {
    ...state,
    error: createStreamError(message, state.index, state.line, state.column),
    mode: "Error",
    complete: false,
  };
}

export function afterValue(stack: number[]): {
  mode: "Done" | "Separator";
  complete: boolean;
} {
  if (stack.length === 0) return { mode: "Done", complete: true };
  return { mode: "Separator", complete: false };
}

export function advancePosition(
  state: InternalState,
  ch: string,
): InternalState {
  return {
    ...state,
    index: state.index + 1,
    line: ch === "\n" ? state.line + 1 : state.line,
    column: ch === "\n" ? 1 : state.column + 1,
  };
}

// --- Identity preservation ---

export function preserveArrayValue(
  prev: JsonValue[] | undefined,
  next: JsonValue[],
): JsonValue[] {
  if (!prev || prev.length !== next.length) return next;
  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i] !== next[i]) return next;
  }
  return prev;
}

export function preserveObjectValue(
  prev: Record<string, JsonValue> | undefined,
  keys: string[],
  next: Record<string, JsonValue>,
): Record<string, JsonValue> {
  if (!prev || Object.keys(prev).length !== keys.length) return next;
  for (const key of keys) {
    if (prev[key] !== next[key]) return next;
  }
  return prev;
}

export function recomputeContainerValue(
  node: AstNode,
  nodes: AstNode[],
): AstNode {
  if (node.kind === "array") {
    const values = node.children.map(
      (childId) => nodes[childId].value as JsonValue,
    );
    const resolved = preserveArrayValue(node.value, values);
    if (resolved === node.value) return node;
    return { ...node, value: resolved } as ArrayNode;
  }
  if (node.kind === "object") {
    const values: Record<string, JsonValue> = {};
    for (let i = 0; i < node.keys.length; i += 1) {
      const key = node.keys[i];
      values[key] = nodes[node.children[i]].value as JsonValue;
    }
    const resolved = preserveObjectValue(node.value, node.keys, values);
    if (resolved === node.value) return node;
    return { ...node, value: resolved } as ObjectNode;
  }
  return node;
}

export function propagateResolved(
  nodes: AstNode[],
  startParentId: number | null,
): AstNode[] {
  let nextNodes = nodes;
  let currentId = startParentId;
  while (currentId !== null) {
    const current = nextNodes[currentId];
    const updated = recomputeContainerValue(current, nextNodes);
    if (updated !== current) {
      nextNodes = replaceNode(nextNodes, currentId, updated);
    }
    currentId = updated.parentId;
  }
  return nextNodes;
}

// --- Node lifecycle ---

export function openNode(
  state: InternalState,
  kind: AstNode["kind"],
): { state: InternalState; nodeId: number } {
  const id = state.nextId;
  const parentId = state.stack.length
    ? state.stack[state.stack.length - 1]
    : null;

  if (state.rootId !== null && parentId === null) {
    return {
      state: toErrorState(state, "Unexpected value after root"),
      nodeId: -1,
    };
  }

  let node: AstNode;
  switch (kind) {
    case "null":
      node = { id, kind, parentId, status: "incomplete", value: undefined };
      break;
    case "boolean":
      node = { id, kind, parentId, status: "incomplete", value: undefined };
      break;
    case "number":
      node = {
        id,
        kind,
        parentId,
        status: "incomplete",
        value: undefined,
        buffer: "",
      };
      break;
    case "string":
      node = {
        id,
        kind,
        parentId,
        status: "incomplete",
        value: undefined,
        buffer: "",
      };
      break;
    case "array":
      node = {
        id,
        kind,
        parentId,
        status: "incomplete",
        value: [],
        children: [],
      };
      break;
    case "object":
      node = {
        id,
        kind,
        parentId,
        status: "incomplete",
        value: {},
        children: [],
        keys: [],
      };
      break;
  }

  let nodes = state.nodes.slice();
  nodes[id] = node;
  let { stack, pendingKey, pendingKeyOwner } = state;

  if (parentId !== null) {
    const parent = nodes[parentId];
    if (parent.kind === "array") {
      const children = parent.children.concat(id);
      const updated = { ...parent, children };
      nodes = replaceNode(nodes, parentId, updated);
      nodes = propagateResolved(nodes, parentId);
    } else if (parent.kind === "object") {
      if (!pendingKey || pendingKeyOwner !== parentId) {
        return {
          state: toErrorState(state, "Missing key before value in object"),
          nodeId: -1,
        };
      }
      const keys = parent.keys.concat(pendingKey);
      const children = parent.children.concat(id);
      const updated = { ...parent, keys, children };
      nodes = replaceNode(nodes, parentId, updated);
      nodes = propagateResolved(nodes, parentId);
      pendingKey = null;
      pendingKeyOwner = null;
    }
  }

  if (kind === "array" || kind === "object") {
    stack = stack.concat(id);
  }

  return {
    state: {
      ...state,
      nodes,
      stack,
      rootId: state.rootId === null ? id : state.rootId,
      nextId: state.nextId + 1,
      pendingKey,
      pendingKeyOwner,
    },
    nodeId: id,
  };
}

export function closePrimitive(
  state: InternalState,
  nodeId: number,
  value: null | boolean | number | string,
): InternalState {
  const node = state.nodes[nodeId];
  const updated = { ...node, status: "complete" as const, value } as AstNode;
  let nodes = replaceNode(state.nodes, nodeId, updated);
  nodes = propagateResolved(nodes, updated.parentId);
  return { ...state, nodes };
}

export function closeContainer(
  state: InternalState,
  nodeId: number,
): InternalState {
  const node = state.nodes[nodeId];
  const updated = { ...node, status: "complete" as const } as AstNode;
  let nodes = replaceNode(state.nodes, nodeId, updated);
  nodes = propagateResolved(nodes, updated.parentId);
  return { ...state, nodes };
}

// --- String helpers ---

export function appendStringFragment(
  state: InternalState,
  fragment: string,
): InternalState {
  if (state.stringContext === "value") {
    if (state.currentNodeId === null) return state;
    const node = state.nodes[state.currentNodeId] as StringNode;
    const nextBuffer = node.buffer + fragment;
    const updated = { ...node, buffer: nextBuffer, value: nextBuffer };
    let nodes = replaceNode(state.nodes, state.currentNodeId, updated);
    nodes = propagateResolved(nodes, updated.parentId);
    return { ...state, nodes };
  }
  return { ...state, keyBuffer: state.keyBuffer + fragment };
}
