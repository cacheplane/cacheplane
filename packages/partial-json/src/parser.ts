// SPDX-License-Identifier: MIT
//
// Push-style parser API layered on top of the pull-style state machine
// (create / push / finish). The pull machine produces an immutable
// `StreamState` containing a flat array of `AstNode`s keyed by stable
// numeric ids. This module mirrors that AST into the public `JsonNode` shape
// (parent/children references, object children as a Map) and turns each
// internal-state transition into a stream of `ParseEvent`s.
//
// Identity preservation: every AstNode id maps to exactly one JsonNode
// instance for the lifetime of the parser. Mutating fields (`status`,
// `value`, `raw`, container `children`) are updated in-place on that
// instance so consumers can hold long-lived references.

import { createInternal } from './create';
import { pushInternal } from './push';
import { finishInternal } from './finish';
import type {
  AstNode,
  ArrayNode,
  ObjectNode,
  StringNode,
  NumberNode,
  StreamState,
  InternalState,
  JsonNode,
  JsonObjectNode,
  JsonArrayNode,
  JsonStringNode,
  JsonNumberNode,
  JsonBooleanNode,
  JsonNullNode,
  StreamStatus,
  ParseEvent,
  PartialJsonParser,
} from './types';

interface NodeSnapshot {
  status: 'incomplete' | 'complete';
  // For string/number: buffer length at the time of last sync.
  bufferLen: number;
  // For containers: number of children at the time of last sync.
  childrenLen: number;
  // For boolean: literal-resolved value.
  resolvedValue: unknown;
}

function statusFor(ast: AstNode): StreamStatus {
  if (ast.status === 'complete') return 'complete';
  // Incomplete keyword/null nodes (true/false/null still being matched) and
  // freshly opened booleans are 'pending' until they finalize. Strings,
  // numbers, arrays, and objects are 'streaming' while they accept input.
  if (ast.kind === 'boolean' || ast.kind === 'null') return 'pending';
  return 'streaming';
}

function unescapeJsonPointer(segment: string): string {
  // RFC 6901: ~1 -> '/', ~0 -> '~' (apply ~1 first).
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function createPartialJsonParser(): PartialJsonParser {
  let state: StreamState = createInternal();
  // Map from AstNode id -> the JsonNode instance we created for it.
  const nodeById = new Map<number, JsonNode>();
  // Snapshot of each node's last-observed shape, keyed by AstNode id.
  const snapshots = new Map<number, NodeSnapshot>();

  function makeJsonNode(ast: AstNode): JsonNode {
    switch (ast.kind) {
      case 'object': {
        const node: JsonObjectNode = {
          id: ast.id,
          type: 'object',
          status: statusFor(ast),
          parent: null,
          key: null,
          children: new Map(),
          pendingKey: null,
        };
        return node;
      }
      case 'array': {
        const node: JsonArrayNode = {
          id: ast.id,
          type: 'array',
          status: statusFor(ast),
          parent: null,
          key: null,
          children: [],
        };
        return node;
      }
      case 'string': {
        const node: JsonStringNode = {
          id: ast.id,
          type: 'string',
          status: statusFor(ast),
          parent: null,
          key: null,
          value: ast.buffer,
        };
        return node;
      }
      case 'number': {
        const node: JsonNumberNode = {
          id: ast.id,
          type: 'number',
          status: statusFor(ast),
          parent: null,
          key: null,
          raw: ast.buffer,
          value: ast.status === 'complete' ? (ast.value ?? null) : null,
        };
        return node;
      }
      case 'boolean': {
        const node: JsonBooleanNode = {
          id: ast.id,
          type: 'boolean',
          status: statusFor(ast),
          parent: null,
          key: null,
          // Default to false until the literal resolves; finalised in sync.
          value: false,
        };
        return node;
      }
      case 'null': {
        const node: JsonNullNode = {
          id: ast.id,
          type: 'null',
          status: statusFor(ast),
          parent: null,
          key: null,
        };
        return node;
      }
    }
  }

  function attachAtCreation(jsonNode: JsonNode, ast: AstNode, after: StreamState): void {
    if (ast.parentId === null) return;
    const parentJson = nodeById.get(ast.parentId);
    if (!parentJson) return;
    const parentAst = after.nodes[ast.parentId];
    jsonNode.parent = parentJson;
    if (parentAst.kind === 'array') {
      const idx = parentAst.children.indexOf(ast.id);
      jsonNode.key = idx;
      const arr = parentJson as JsonArrayNode;
      arr.children[idx] = jsonNode;
    } else if (parentAst.kind === 'object') {
      const idx = parentAst.children.indexOf(ast.id);
      const key = parentAst.keys[idx];
      jsonNode.key = key;
      const obj = parentJson as JsonObjectNode;
      obj.children.set(key, jsonNode);
    }
  }

  function diffStates(before: StreamState, after: StreamState): ParseEvent[] {
    const created: ParseEvent[] = [];
    const valueUpdates: ParseEvent[] = [];
    const completedIds: { id: number; event: ParseEvent }[] = [];

    for (let id = 0; id < after.nodes.length; id += 1) {
      const ast = after.nodes[id];
      if (!ast) continue;
      const prevSnap = snapshots.get(id);

      if (!prevSnap) {
        // New node — materialise it and link to its parent. JsonNode is
        // always seeded as not-yet-complete so that the completion branch
        // below fires for nodes that were created and completed in the same
        // push (e.g. `[true]` or `""`).
        const jsonNode = makeJsonNode(ast);
        // Force initial status to streaming/pending regardless of the AST's
        // current status; the diff loop below will transition to 'complete'
        // and emit the node-completed event.
        jsonNode.status =
          ast.kind === 'boolean' || ast.kind === 'null' ? 'pending' : 'streaming';
        nodeById.set(id, jsonNode);
        attachAtCreation(jsonNode, ast, after);
        created.push({ type: 'node-created', node: jsonNode });

        // Initial snapshot starts at zero/incomplete so subsequent
        // change-detection in this same diff pass picks up any growth and
        // any status flip that happened in the producing push.
        snapshots.set(id, {
          status: 'incomplete',
          bufferLen: 0,
          childrenLen: 0,
          resolvedValue: undefined,
        });

        // If this node was already complete on creation (e.g. an empty
        // string `""` or an empty container `[]`), emit a node-completed
        // event below. Fall through to the change-detection branch by
        // updating the snapshot to incomplete first so the logic below
        // catches the transition.
      }

      const jsonNode = nodeById.get(id);
      if (!jsonNode) continue;
      const snap = snapshots.get(id)!;

      // Detect string growth.
      if (ast.kind === 'string') {
        const strNode = jsonNode as JsonStringNode;
        if (ast.buffer.length > snap.bufferLen) {
          const delta = ast.buffer.slice(snap.bufferLen);
          strNode.value = ast.buffer;
          snap.bufferLen = ast.buffer.length;
          valueUpdates.push({ type: 'value-updated', node: strNode, delta });
        }
      }

      // Detect number raw growth.
      if (ast.kind === 'number') {
        const numNode = jsonNode as JsonNumberNode;
        if (ast.buffer.length > snap.bufferLen) {
          numNode.raw = ast.buffer;
          snap.bufferLen = ast.buffer.length;
          valueUpdates.push({ type: 'value-updated', node: numNode });
        }
      }

      // Detect new container children — the JsonNode children references
      // are populated by attachAtCreation when the child node is itself
      // visited above. Sync container length here for snapshot accuracy.
      if (ast.kind === 'array' || ast.kind === 'object') {
        snap.childrenLen = ast.children.length;
      }

      // Detect completion.
      const newStatus = statusFor(ast);
      if (jsonNode.status !== newStatus) {
        jsonNode.status = newStatus;
        if (newStatus === 'complete') {
          // Finalise resolved values for primitive leaves.
          if (ast.kind === 'number') {
            const numNode = jsonNode as JsonNumberNode;
            numNode.value = (ast.value as number | undefined) ?? null;
            numNode.raw = ast.buffer;
          } else if (ast.kind === 'string') {
            (jsonNode as JsonStringNode).value = ast.buffer;
          } else if (ast.kind === 'boolean') {
            (jsonNode as JsonBooleanNode).value = ast.value === true;
          }
          completedIds.push({ id, event: { type: 'node-completed', node: jsonNode } });
        }
        snap.status = ast.status;
      }
    }

    // Completion events emitted deepest-first so that consumers see child
    // completion before the enclosing container's close event.
    completedIds.sort((a, b) => b.id - a.id);

    return [...created, ...valueUpdates, ...completedIds.map((c) => c.event)];
  }

  function getByPath(path: string): JsonNode | null {
    if (state.rootId === null) return null;
    const root = nodeById.get(state.rootId) ?? null;
    if (!root) return null;
    if (path === '' || path === '/') return root;

    const normalized = path.startsWith('/') ? path : '/' + path;
    const segments = normalized.split('/').slice(1).map(unescapeJsonPointer);

    let current: JsonNode = root;
    for (const segment of segments) {
      if (current.type === 'object') {
        const child = current.children.get(segment);
        if (!child) return null;
        current = child;
      } else if (current.type === 'array') {
        const index = parseInt(segment, 10);
        if (Number.isNaN(index)) return null;
        const child = current.children[index];
        if (!child) return null;
        current = child;
      } else {
        return null;
      }
    }
    return current;
  }

  return {
    push(chunk: string): ParseEvent[] {
      if (chunk.length === 0) return [];
      const before = state;
      state = pushInternal(state as InternalState, chunk);
      return diffStates(before, state);
    },
    finish(): ParseEvent[] {
      const before = state;
      state = finishInternal(state as InternalState);
      return diffStates(before, state);
    },
    get root(): JsonNode | null {
      if (state.rootId === null) return null;
      return nodeById.get(state.rootId) ?? null;
    },
    getByPath,
  };
}
