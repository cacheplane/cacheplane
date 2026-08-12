# @cacheplane/partial-json

Streaming JSON parser for incomplete input.

Use it when an AI model, network stream, worker, or tool call emits JSON a
chunk at a time. `JSON.parse()` needs a complete document. This parser gives
you a typed tree while the document is still arriving, and keeps node object
identity stable as later chunks update the tree.

## Install

```bash
npm install @cacheplane/partial-json
```

Runtime and packaging:

- Node `>=20`
- TypeScript declarations included
- ESM and CJS bundled
- Uses `@cacheplane/json-stream` as its runtime parser kernel
- Marked side-effect free

## 30-Second Example

```ts
import { createPartialJsonParser } from '@cacheplane/partial-json';

const parser = createPartialJsonParser();

parser.push('{"items":[{"name":"alpha","done":');
parser.push('true},{"name":"beta');

const first = parser.getByPath('/items/0/name');
const second = parser.getByPath('/items/1/name');

console.log(first);
// { type: 'string', value: 'alpha', status: 'complete', ... }

console.log(second);
// { type: 'string', value: 'beta', status: 'streaming', ... }
```

The parser does not throw just because the input ends mid-token. Every public
node carries `status: 'pending' | 'streaming' | 'complete'`, so a UI can render
what exists now and let nodes resolve in place.

## When To Use It

Use `@cacheplane/partial-json` when you need to:

- Render structured LLM output before the model finishes.
- Watch one field in a streaming tool-call argument object.
- Preserve React, Angular, Solid, or custom renderer memoization across chunks.
- Convert a live parser tree into plain JS snapshots without replacing
  unchanged subtrees.
- Parse strict JSON incrementally without regex trimming or repair loops.

It is not a JSON repair library. Invalid JSON still becomes an error; truncated
JSON is treated as ordinary in-progress input.

## Mental Model

The parser builds a node tree. Nodes are mutated in place as more input arrives.
Each node has:

- `id`: stable numeric identity for the lifetime of the parser.
- `type`: JSON node type.
- `status`: `pending`, `streaming`, or `complete`.
- `parent`: parent node or `null`.
- `key`: object property key, array index, or `null` for the root.

Container nodes expose children:

- Object nodes use `children: Map<string, JsonNode>`.
- Array nodes use `children: JsonNode[]`.

Scalar nodes expose values:

- String nodes expose partial `value` while streaming.
- Number nodes expose `raw` while streaming and parsed `value` after completion.
- Boolean and null nodes remain `pending` until the literal resolves.

## Push-Style API

Use the push-style API for streaming UIs and long-lived node references.

```ts
import {
  createPartialJsonParser,
  materialize,
} from '@cacheplane/partial-json';

const parser = createPartialJsonParser();

for await (const chunk of llmStream) {
  const events = parser.push(chunk);

  for (const event of events) {
    if (event.type === 'value-updated') {
      // event.node is the same object reference across future pushes.
    }
  }

  if (parser.root) {
    const snapshot = materialize(parser.root);
    render(snapshot);
  }
}

parser.finish();
```

`push(chunk)` and `finish()` return `ParseEvent[]`:

```ts
interface ParseEvent {
  type: 'node-created' | 'value-updated' | 'node-completed';
  node: JsonNode;
  delta?: string;
}
```

### JSON Pointer Lookup

`getByPath()` accepts JSON Pointer paths:

```ts
parser.getByPath('');                  // root
parser.getByPath('/items/0/name');     // array index + object key
parser.getByPath('/a~1b/~0key');       // RFC 6901 escaping
```

Missing paths return `null`.

## Pull-Style API

Use the pull-style API when you want immutable parser state, such as reducers,
undo/redo stacks, deterministic tests, or state-machine integrations.

```ts
import { create, push, finish, resolve } from '@cacheplane/partial-json';

let state = create();
state = push(state, '{"a":1');
state = push(state, ',"b":2}');
state = finish(state);

const value = resolve(state);
// { a: 1, b: 2 }
```

Each call returns a new `StreamState`.

## Structural-Sharing Snapshots

`materialize(node)` converts a parser node tree into a plain JavaScript value.
It uses a `WeakMap` cache keyed by node identity, so unchanged subtrees return
the same object reference across calls.

```ts
const before = materialize(parser.root!);

parser.push(',"next":true');

const after = materialize(parser.root!);
```

This is useful when rendering every animation frame or every stream chunk.
Consumers that compare references only re-render subtrees that actually changed.

## Guarantees

`@cacheplane/partial-json` guarantees:

- Truncated valid-prefix JSON is parseable as in-progress input.
- Public push-style node object identity is stable across pushes.
- Node status uses the same `pending | streaming | complete` lifecycle as
  `@cacheplane/partial-markdown`.
- `materialize()` preserves references for unchanged subtrees.
- Duplicate object keys follow normal JavaScript materialization semantics:
  later values win.
- `finish()` closes valid trailing constructs that can complete at end of input,
  such as a number waiting for a terminator.
- Syntax errors are recorded in parser state rather than hidden by best-effort
  repair.

## Limits

This package does not:

- Repair invalid JSON.
- Accept JSON5 features such as comments, single-quoted strings, trailing
  commas, unquoted object keys, `.5`, or `+1`.
- Preserve duplicate object-key history in materialized output.
- Validate application-level schemas.
- Stream multiple top-level JSON documents through one parser instance.

Create a new parser for each top-level document.

## Node Shape

```ts
interface JsonNodeBase {
  readonly id: number;
  readonly type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  status: 'pending' | 'streaming' | 'complete';
  parent: JsonNode | null;
  key: string | number | null;
}
```

Object nodes:

```ts
interface JsonObjectNode extends JsonNodeBase {
  readonly type: 'object';
  children: Map<string, JsonNode>;
  pendingKey: string | null;
}
```

Array nodes:

```ts
interface JsonArrayNode extends JsonNodeBase {
  readonly type: 'array';
  children: JsonNode[];
}
```

Scalar nodes:

```ts
interface JsonStringNode extends JsonNodeBase {
  readonly type: 'string';
  value: string;
}

interface JsonNumberNode extends JsonNodeBase {
  readonly type: 'number';
  raw: string;
  value: number | null;
}

interface JsonBooleanNode extends JsonNodeBase {
  readonly type: 'boolean';
  value: boolean;
}

interface JsonNullNode extends JsonNodeBase {
  readonly type: 'null';
}
```

## Type Guards

```ts
import {
  isObjectNode,
  isArrayNode,
  isStringNode,
  isNumberNode,
  isBoolNode,
  isNullNode,
  isComplete,
} from '@cacheplane/partial-json';

const node = parser.getByPath('/title');

if (node && isStringNode(node) && isComplete(node)) {
  console.log(node.value);
}
```

## Common Patterns

### Render A Streaming Response

```ts
const parser = createPartialJsonParser();

for await (const chunk of llmStream) {
  parser.push(chunk);
  render(parser.root);
}

parser.finish();
```

### Watch A Specific Field

```ts
parser.push(chunk);

const status = parser.getByPath('/result/status');

if (status?.status === 'complete' && status.type === 'string') {
  console.log('final status:', status.value);
}
```

### Read Partial String Content

```ts
const title = parser.getByPath('/title');

if (title?.type === 'string') {
  renderTitle(title.value, { final: title.status === 'complete' });
}
```

### Detect End Of Document

```ts
parser.finish();

if (parser.root?.status === 'complete') {
  const value = materialize(parser.root);
}
```

## Troubleshooting

**`parser.root` is `null`.**
No root node has been created yet. Push a non-whitespace chunk first.

**A number has `value: null`.**
The number is still streaming. Use `raw` for display, or wait until
`status === 'complete'`.

**A boolean or null node is `pending`.**
The literal has not resolved yet. For example, `tr` may become `true`.

**`resolve(state)` returns `undefined`.**
The pull-style state does not currently contain a complete resolvable value.
Call `finish()` when the stream ends and check `state.error`.

**Invalid JSON produces an error.**
This is expected. The parser tolerates truncation, not malformed syntax.

## API Reference

```ts
// Push-style
createPartialJsonParser(): PartialJsonParser

interface PartialJsonParser {
  push(chunk: string): ParseEvent[];
  finish(): ParseEvent[];
  readonly root: JsonNode | null;
  getByPath(path: string): JsonNode | null;
}

materialize(node: JsonNode): unknown;

// Pull-style
create(): StreamState;
push(state: StreamState, chunk: string): StreamState;
finish(state: StreamState): StreamState;
resolve(state: StreamState): JsonValue | undefined;

// Type guards
isObjectNode(node): node is JsonObjectNode;
isArrayNode(node): node is JsonArrayNode;
isStringNode(node): node is JsonStringNode;
isNumberNode(node): node is JsonNumberNode;
isBoolNode(node): node is JsonBooleanNode;
isNullNode(node): node is JsonNullNode;
isComplete(node): boolean;
```

Exported types:

```ts
JsonNode, JsonValue, StreamStatus, StreamState, StreamError, ParseEvent,
JsonObjectNode, JsonArrayNode, JsonStringNode, JsonNumberNode,
JsonBooleanNode, JsonNullNode, JsonNodeType,
AstNode, ObjectNode, ArrayNode, StringNode, NumberNode, BoolNode, NullNode
```

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md).

## License

MIT
