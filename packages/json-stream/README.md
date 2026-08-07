# @cacheplane/json-stream

Incremental JSON parser for input that arrives a chunk at a time.

Use it when an AI model, network stream, worker, or tool call emits JSON
progressively. `JSON.parse()` needs a complete document; this parser gives you a
typed tree while the document is still arriving, marking each node `partial` or
`complete` so you can render what has landed and leave the rest.

## Install

```bash
npm install @cacheplane/json-stream
```

Runtime and packaging:

- Node `>=20`
- TypeScript declarations included
- ESM and CJS bundled
- Zero runtime dependencies
- Marked side-effect free

## 30-Second Example

```ts
import { create, push, finish, isObjectNode } from "@cacheplane/json-stream";

let state = create();

for (const chunk of ['{"name": "Ada', '", "age": 3', "6}"]) {
  state = push(state, chunk);
}

state = finish(state);

if (isObjectNode(state.root)) {
  // Every node carries a status, so a half-arrived string is still readable.
  console.log(state.root.status); // "complete"
}
```

## Mental Model

Three functions drive the whole parser, and each returns a new `StreamState`
rather than mutating the one you passed:

- `create()` — a fresh, empty state.
- `push(state, chunk)` — feed the next chunk; safe to call at any byte boundary,
  including mid-token and mid-escape-sequence.
- `finish(state)` — signal end of input. Anything still open is resolved or
  reported as a `StreamError`.

Every node in the tree carries a `status` of `partial` or `complete`. That is
the distinction the whole library exists for: a consumer can render a string
that is still arriving, and know not to treat it as final.

## Type Guards

Narrowing helpers for each node kind, plus a status check:

```ts
import {
  isArrayNode,
  isBoolNode,
  isComplete,
  isNullNode,
  isNumberNode,
  isObjectNode,
  isStringNode,
} from "@cacheplane/json-stream";
```

`isComplete(node)` is the one to reach for when deciding whether a value is
safe to commit downstream.

## JSON Pointer Lookup

`resolve` reads a node out of the tree by [RFC 6901][rfc6901] pointer, which is
convenient when you care about one field of a large streaming document:

```ts
import { resolve } from "@cacheplane/json-stream";

const node = resolve(state.root, "/choices/0/message/content");
```

It returns `undefined` when the path does not exist yet — a normal condition
mid-stream, not an error.

[rfc6901]: https://datatracker.ietf.org/doc/html/rfc6901

## Related

- [`@cacheplane/partial-json`](../partial-json) — a richer partial-JSON parser
  with identity preservation and structural-sharing materialization.
- [`@cacheplane/partial-markdown`](../partial-markdown) — the same idea for
  streaming Markdown.

## License

MIT
