# @cacheplane/partial-markdown

Streaming partial-Markdown parser. Returns a structured AST as bytes arrive, preserves object identity across mutations, and supports both pull-style (`create / push / finish / resolve`) and push-style (`createPartialMarkdownParser` with events) APIs.

Sister package to [`@cacheplane/partial-json`](https://github.com/cacheplane/cacheplane-partial-json) — same architectural shape applied to markdown instead of JSON.

## Install

```bash
npm install @cacheplane/partial-markdown
```

## Quick start

```ts
import { createPartialMarkdownParser, materialize } from '@cacheplane/partial-markdown';

const parser = createPartialMarkdownParser();
parser.push('# Hello\n\nThis is **bold**.');
parser.push(' And `code`.');
parser.finish();

const heading = parser.getByPath('/children/0');
const snapshot = materialize(parser.root);
```

## API

### Pull-style

```ts
import { create, push, finish, resolve } from '@cacheplane/partial-markdown';

let state = create();
state = push(state, '# Hello\n');
state = finish(state);
const tree = resolve(state);
```

### Push-style

```ts
import { createPartialMarkdownParser } from '@cacheplane/partial-markdown';

const parser = createPartialMarkdownParser();
const events = parser.push('## Title\n\nSome paragraph.');
// events: [{ type: 'node-created', node: ... }, { type: 'value-updated', node: ..., delta: ... }, ...]
```

## Supported syntax

### v0.1 core

- **Block-level**: documents, paragraphs, headings (h1–h6), unordered + ordered lists, blockquotes, fenced code blocks, thematic breaks (`---`).
- **Inline**: emphasis (`*x*` / `_x_`), strong (`**x**` / `__x__`), strikethrough (`~~x~~`), inline code (`` `x` ``), links (`[text](url)`), autolinks (`<https://…>`), images (`![alt](url)`), soft + hard line breaks.

### v0.2 additions

#### Citations (Pandoc footnote-style)

Inline references and block-level definitions are extracted into a `citations` Map on the document root.

```md
Some claim.[^src1]

[^src1]: Source title <https://example.com>
```

The parser assigns 1-based indices in first-touch order. References stream
through a `resolved: false → true` flip when their matching definition arrives,
preserving node identity. Definitions live in `document.citations: Map<string, CitationDefinition>`.

#### GFM Tables

Standard pipe-delimited tables with alignment metadata:

```md
| Header | Aligned |
| :---   | ---:    |
| left   | right   |
```

The alignment row is consumed (not retained as a node); alignment data lifts
to `TableNode.alignments`. Body rows shorter than header width are padded;
overflow rows truncate with a `table_overflow` warning.

#### GFM Task Lists

Task list items via the `task` field on `MarkdownListItemNode`:

```md
- [x] done
- [ ] todo
- regular item
```

Plain items have `task === undefined`; task items have `task: { checked: boolean }`.

#### Streaming Identity

The `materialize()` function uses a `WeakMap`-based snapshot cache that preserves
object identity across frames. The following mutations preserve or correctly
invalidate cached snapshots:

- **Table**: cell/row/table reference stability across new row appends.
- **Citation reference**: the `resolved` flag is mutated in place on the push-style node when a matching definition arrives; `materialize()` produces a fresh snapshot wrapper.
- **Task list item**: `task.checked` changes produce fresh snapshots.
- **Citations Map**: the `document.citations` Map is iterated in insertion order; each entry is a `CitationDefinition` with stable `id`, `index`, `children`, and `status` fields.

**Not yet supported**: link reference definitions, HTML inline/blocks, math, custom syntax extensions.

### v0.3 additions

#### Nested lists

GFM-compatible nested list parsing. Sub-items are recognized when their marker
is indented at least 2 columns past the parent marker column, or past the
parent's content column (whichever is more permissive). This matches LLM output
patterns, where output like `10. Parent\n  - Sub` (strict CommonMark requires
4-space indent, but 2-space is accepted) would otherwise flatten to siblings.

```md
- Item 1
  - Sub 1.1
  - Sub 1.2
    - Sub 1.2.1
- Item 2
```

Tabs are measured as advancing to the next 4-column tab stop. Mixed tabs and
spaces are supported.

Each `MarkdownListNode` now exposes advisory layout fields:
- `markerCol` — column where the marker character appears (0-based).
- `contentCol` — column where item content starts (after marker + space).

These fields are advisory; consumers who do not care about layout can ignore them.

#### `StreamStatus` type rename

`MarkdownNodeStatus` is renamed to `StreamStatus` to align with
`@cacheplane/partial-json@0.2.0`. Both packages now export structurally
identical tristate types (`'pending' | 'streaming' | 'complete'`).

```ts
// Before (0.2.x)
import type { MarkdownNodeStatus } from '@cacheplane/partial-markdown';

// After (0.3.0)
import type { StreamStatus } from '@cacheplane/partial-markdown';
```

## License

MIT
