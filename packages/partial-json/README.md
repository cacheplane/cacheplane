# @cacheplane/partial-json

Streaming JSON parser for incomplete input. Built for parsing the output of LLMs token by token, but works on any byte stream.

```ts
import { createPartialJsonParser } from '@cacheplane/partial-json';

const parser = createPartialJsonParser();
parser.push('{"items":[{"name":"alpha","done":');   // mid-token cutoff
parser.push('true},{"name":"beta');                  // mid-string cutoff

parser.getByPath('/items/0/name');
// { type: 'string', value: 'alpha', status: 'complete', ... }

parser.getByPath('/items/1/name');
// { type: 'string', value: 'beta', status: 'streaming', ... }
```

The parser never throws on truncation. Every node carries a `status: 'pending' | 'streaming' | 'complete'` — you can render incomplete data as it arrives and let nodes resolve in place.

## Why

Streaming LLMs emit JSON one fragment at a time, often mid-string or mid-number. `JSON.parse` requires the whole document. Workarounds (try/catch loops, regex tail-trimming, "best-effort" parsers that lose structure) all leak complexity into your UI layer.

This parser does the right thing: gives you a typed AST that grows in place, with stable node identity across pushes so React/Angular/Solid can use referential equality for memoization.

## Install

```bash
npm install @cacheplane/partial-json
```

ESM and CJS bundled, zero runtime dependencies, side-effect free.

## Two APIs over one core

Mix freely — both produce the same node graph.

### Push-style (recommended for UI streaming)

```ts
import { createPartialJsonParser, materialize } from '@cacheplane/partial-json';

const parser = createPartialJsonParser();
parser.push(chunk);

// Walk the tree:
parser.root;                            // root JsonNode (or null before any input)
parser.getByPath('/items/0/name');      // JSON Pointer lookup, partial-aware

// Snapshot a plain JS value with structural sharing:
const snapshot = materialize(parser.root);
```

`materialize()` reuses subtrees that haven't changed since the previous call, so you can snapshot on every render frame without busting downstream memoization.

### Pull-style (immutable state)

```ts
import { create, push, finish, resolve } from '@cacheplane/partial-json';

let state = create();
state = push(state, '{"a":1');
state = push(state, ',"b":2}');
state = finish(state);

const value = resolve(state);   // { a: 1, b: 2 }
```

Each call returns a new state object. Useful inside reducers and undo/redo stacks.

## Node shape

```ts
interface JsonNodeBase {
  readonly id: number;                                // stable identity, never changes
  readonly type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  status: 'pending' | 'streaming' | 'complete';
  parent: JsonNode | null;
  key: string | number | null;                        // key in parent object, or array index
}
```

- `JsonObjectNode` adds `children: Map<string, JsonNode>` (insertion-ordered).
- `JsonArrayNode` adds `children: JsonNode[]`.
- Scalars (`string`, `number`, `boolean`, `null`) carry `value`. Strings expose partial content while `status === 'streaming'`.

Type guards are exported for narrowing:

```ts
import { isObjectNode, isStringNode, isComplete } from '@cacheplane/partial-json';

const node = parser.getByPath('/title');
if (node && isStringNode(node) && isComplete(node)) {
  // node.value is the fully-parsed string
}
```

## Common patterns

### Render a streaming response

```ts
const parser = createPartialJsonParser();

for await (const chunk of llmStream) {
  parser.push(chunk);
  render(parser.root);   // node identity stable across calls — safe for keyed renders
}

parser.finish();
```

### Watch a specific field

```ts
parser.push(chunk);
const status = parser.getByPath('/result/status');
if (status?.status === 'complete') {
  console.log('result.status finalized:', status.value);
}
```

### Detect end of document

```ts
if (parser.root?.status === 'complete') {
  // safe to materialize and discard
}
```

### Snapshot for diffing

```ts
const before = materialize(parser.root);
parser.push(nextChunk);
const after = materialize(parser.root);
// Subtrees that didn't change are reference-equal between `before` and `after`.
```

## API reference

```ts
// Push-style
createPartialJsonParser(): PartialJsonParser

interface PartialJsonParser {
  push(chunk: string): ParseEvent[];
  finish(): ParseEvent[];
  readonly root: JsonNode | null;
  getByPath(path: string): JsonNode | null;   // JSON Pointer (RFC 6901)
}

materialize(node: JsonNode): JsonValue;       // structural-sharing snapshot

// Pull-style
create(): StreamState;
push(state: StreamState, chunk: string): StreamState;
finish(state: StreamState): StreamState;
resolve(state: StreamState): JsonValue | undefined;

// Type guards
isObjectNode, isArrayNode, isStringNode, isNumberNode,
isBoolNode, isNullNode, isComplete

// Types
JsonNode, JsonValue, StreamStatus, StreamState, StreamError, ParseEvent
JsonObjectNode, JsonArrayNode, JsonStringNode, JsonNumberNode,
JsonBooleanNode, JsonNullNode, JsonNodeType
```

## License

MIT
