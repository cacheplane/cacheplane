# Cacheplane

Streaming parsers for AI interfaces.

Cacheplane helps applications render structured model output while it is still
arriving. LLMs routinely stream JSON and Markdown mid-token, mid-string,
mid-list, or mid-table. Traditional parsers wait for the whole document;
Cacheplane gives you a typed tree that grows in place, with stable node identity
so UI layers can render partial output without losing memoization.

## Packages

| Package | npm | Use it for | Highlights |
|---|---|---|---|
| [`@cacheplane/json-stream`](packages/json-stream) | [![npm](https://img.shields.io/npm/v/@cacheplane/json-stream.svg)](https://www.npmjs.com/package/@cacheplane/json-stream) | JSON arriving a chunk at a time from a model, socket, or tool call | Per-node `partial`/`complete` status, chunk-boundary safe, JSON Pointer lookup, zero dependencies |
| [`@cacheplane/partial-json`](packages/partial-json) | [![npm](https://img.shields.io/npm/v/@cacheplane/partial-json.svg)](https://www.npmjs.com/package/@cacheplane/partial-json) | JSON streamed from an LLM or any incremental source | Partial strings and numbers, JSON Pointer lookup, push and pull APIs, structural-sharing snapshots |
| [`@cacheplane/partial-markdown`](packages/partial-markdown) | [![npm](https://img.shields.io/npm/v/@cacheplane/partial-markdown.svg)](https://www.npmjs.com/package/@cacheplane/partial-markdown) | Markdown streamed into chat, agent logs, reports, or AI writing surfaces | Headings, lists, task lists, tables, citations, link references, math, raw HTML, inline formatting, stable AST identity |

Both packages are:

- Built for Node `>=20`
- TypeScript-first
- ESM and CJS bundled
- Zero runtime dependencies
- Marked side-effect free
- Published independently under `@cacheplane/*`

## Why This Exists

AI products increasingly render model output as it streams: tool arguments,
structured extraction results, reports, citations, markdown answers, task lists,
and agent traces. The hard part is not just accepting incomplete input. The hard
part is giving the UI a stable representation while the input is still changing.

Cacheplane parsers are designed around that constraint:

- **Truncation tolerant:** incomplete input is normal, not an exception path.
- **Stable node identity:** a node keeps the same object reference as future
  chunks update it.
- **Streaming status:** every public node exposes
  `pending | streaming | complete`.
- **Evented updates:** push-style parsers return node creation, value update,
  and completion events.
- **Structural-sharing snapshots:** `materialize()` returns plain values while
  preserving references for unchanged subtrees.

The result is a parser layer that works naturally with React memoization,
Angular OnPush, Solid signals, editor views, virtualized renderers, and custom
agent UIs.

## Quick Start

Install the package you need:

```bash
npm install @cacheplane/partial-json
npm install @cacheplane/partial-markdown
```

Parse JSON while it streams:

```ts
import { createPartialJsonParser, materialize } from '@cacheplane/partial-json';

const parser = createPartialJsonParser();

parser.push('{"items":[{"title":"Alpha"},{"title":"Bet');

const first = parser.getByPath('/items/0/title');
const second = parser.getByPath('/items/1/title');

console.log(first?.status);  // "complete"
console.log(second?.status); // "streaming"
console.log(materialize(parser.root!));
```

Parse Markdown while it streams:

```ts
import { createPartialMarkdownParser } from '@cacheplane/partial-markdown';

const parser = createPartialMarkdownParser();

parser.push('# Plan\n\n- [ ] Parse stream');
parser.push('\n- [x] Render stable tree\n');

for (const block of parser.root?.children ?? []) {
  console.log(block.type, block.status);
}
```

See the package READMEs for full API details:

- [`@cacheplane/json-stream`](packages/json-stream/README.md)
- [`@cacheplane/partial-json`](packages/partial-json/README.md)
- [`@cacheplane/partial-markdown`](packages/partial-markdown/README.md)

## API Shape

Each package exposes two APIs over the same parser core.

### Push-style API

Use this for UI streaming, agent output renderers, and anything that wants
long-lived node references.

```ts
const parser = createPartialJsonParser();

const events = parser.push(chunk);
parser.root;
parser.getByPath('/path/to/node');
parser.finish();
```

`push()` and `finish()` return parser events:

- `node-created`
- `value-updated`
- `node-completed`

### Pull-style API

Use this for reducers, deterministic state transitions, undo/redo stacks, and
tests that prefer immutable state objects.

```ts
let state = create();
state = push(state, chunk);
state = finish(state);
const value = resolve(state);
```

## Repository Layout

```text
packages/
  json-stream/        Published package: @cacheplane/json-stream
  partial-json/       Published package: @cacheplane/partial-json
  partial-markdown/   Published package: @cacheplane/partial-markdown
apps/                 Reserved for deployable apps
libs/                 Reserved for private workspace libraries
tools/                Reserved for repo-internal scripts
docs/
  specs/              Design specs for larger changes
  plans/              Implementation plans for larger changes
```

Tests live next to package source files under `packages/*/src`.

## Development

Install dependencies:

```bash
pnpm install
```

Run the full local verification suite:

```bash
pnpm verify
```

Common commands:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
```

Package-scoped commands:

```bash
pnpm --filter @cacheplane/json-stream test
pnpm --filter @cacheplane/json-stream build
pnpm --filter @cacheplane/json-stream publint
pnpm --filter @cacheplane/json-stream attw

pnpm --filter @cacheplane/partial-json test
pnpm --filter @cacheplane/partial-json build
pnpm --filter @cacheplane/partial-json publint
pnpm --filter @cacheplane/partial-json attw

pnpm --filter @cacheplane/partial-markdown test
pnpm --filter @cacheplane/partial-markdown build
pnpm --filter @cacheplane/partial-markdown publint
pnpm --filter @cacheplane/partial-markdown attw
```

Build output is written to `packages/*/dist`.

## Contributing Parser Changes

Parser behavior is public API. When changing it:

1. Add or update focused tests in the affected package.
2. Preserve node identity across pushes unless the README explicitly says a
   reference can be replaced.
3. Keep `pending | streaming | complete` transitions intentional and tested.
4. Update the package README when behavior, guarantees, warnings, or unsupported
   syntax changes.
5. Update the package `CHANGELOG.md` for released user-visible changes.
6. Run `pnpm verify` before opening a PR.

For packaging changes, also run the package's `publint` and `attw` scripts.
These catch common npm, ESM, CJS, and TypeScript declaration regressions before
publish.

## Releasing

Packages are versioned and released independently. Releases are tag-routed via
the publish workflow:

- `json-stream-v0.0.4` publishes `@cacheplane/json-stream@0.0.4`
- `partial-json-v0.2.1` publishes `@cacheplane/partial-json@0.2.1`
- `partial-markdown-v0.3.2` publishes `@cacheplane/partial-markdown@0.3.2`

See [`RELEASING.md`](RELEASING.md) for the release process.

## Support

- Open issues in the [Cacheplane GitHub repository](https://github.com/cacheplane/cacheplane/issues).
- Check package changelogs before upgrading:
  - [`packages/json-stream/CHANGELOG.md`](packages/json-stream/CHANGELOG.md)
  - [`packages/partial-json/CHANGELOG.md`](packages/partial-json/CHANGELOG.md)
  - [`packages/partial-markdown/CHANGELOG.md`](packages/partial-markdown/CHANGELOG.md)

Monorepo-level changes (CI, tooling, workspace structure) are tracked in the root [CHANGELOG.md](CHANGELOG.md). Per-package release notes live in each package's own `CHANGELOG.md`.

## License

MIT
