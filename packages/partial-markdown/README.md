# @cacheplane/partial-markdown

Streaming Markdown parser for incomplete input. Built for parsing the output of LLMs token by token, but works on any byte stream.

```ts
import { createPartialMarkdownParser } from '@cacheplane/partial-markdown';

const parser = createPartialMarkdownParser();
parser.push('# Hello\n\nThis is **bold');   // mid-emphasis cutoff
parser.push('** text.');

const heading = parser.getByPath('/children/0');
// { type: 'heading', level: 1, status: 'complete', ... }

const paragraph = parser.getByPath('/children/1');
// { type: 'paragraph', status: 'complete', children: [...] }
```

The parser never throws on truncation. Every node carries a `status: 'pending' | 'streaming' | 'complete'` — you can render incomplete markdown as it arrives and let nodes resolve in place.

## Why

Streaming LLMs emit Markdown one fragment at a time, often mid-emphasis, mid-list, or mid-table. Standard Markdown parsers want a complete document. Workarounds (re-parse on every chunk, throw away partial state) blow up your memoization and flicker the UI.

This parser does the right thing: gives you a typed AST that grows in place, with stable node identity across pushes so React/Angular/Solid can use referential equality for memoization.

## Install

```bash
npm install @cacheplane/partial-markdown
```

ESM and CJS bundled, zero runtime dependencies, side-effect free.

## Two APIs over one core

Mix freely — both produce the same node graph.

### Push-style (recommended for UI streaming)

```ts
import { createPartialMarkdownParser, materialize } from '@cacheplane/partial-markdown';

const parser = createPartialMarkdownParser();
parser.push(chunk);

parser.root;                            // MarkdownDocumentNode (or null before any input)
parser.getByPath('/children/0');        // JSON Pointer lookup, partial-aware
const snapshot = materialize(parser.root);
```

`materialize()` reuses subtrees that haven't changed since the previous call, so you can snapshot on every render frame without busting downstream memoization.

### Pull-style (immutable state)

```ts
import { create, push, finish, resolve } from '@cacheplane/partial-markdown';

let state = create();
state = push(state, '# Title\n\nParagraph');
state = finish(state);

const tree = resolve(state);
```

Each call returns a new state object. Useful inside reducers and undo/redo stacks.

## Supported syntax

### Block-level

Documents, paragraphs, headings (`#` through `######`), blockquotes (`>`), unordered lists (`-`, `*`, `+`), ordered lists (`1.`), task lists (`- [x]`, `- [ ]`), fenced code blocks (`` ``` ``), indented code blocks, thematic breaks (`---`), and GFM tables.

### Inline

Emphasis (`*x*`, `_x_`), strong (`**x**`, `__x__`), strikethrough (`~~x~~`), inline code (`` `x` ``), links (`[text](url)`), autolinks (`<https://…>`), images (`![alt](url)`), and soft / hard line breaks.

### Citations (Pandoc footnote-style)

```md
Some claim.[^src1]

[^src1]: Source title <https://example.com>
```

Inline references and block-level definitions are extracted into a `citations: Map<string, CitationDefinition>` on the document root. The parser assigns 1-based indices in first-touch order. References stream through a `resolved: false → true` flip when their matching definition arrives, preserving node identity.

### Nested lists

GFM-compatible. Sub-items are recognized when their marker is indented at least 2 columns past the parent's marker column or content column — whichever is more permissive. This is intentionally looser than strict CommonMark (which requires 4 spaces) because LLM output reliably uses 2-space indents.

```md
- Item 1
  - Sub 1.1
  - Sub 1.2
    - Sub 1.2.1
- Item 2
```

Tabs advance to the next 4-column tab stop. Mixed tabs and spaces are supported. Each `MarkdownListNode` exposes advisory `markerCol` / `contentCol` fields for layout-aware consumers.

### Tables (GFM)

```md
| Header | Aligned |
| :---   | ---:    |
| left   | right   |
```

The alignment row is consumed (not retained as a node); alignment data lifts to `MarkdownTableNode.alignments`. Body rows shorter than header width are padded; overflow rows truncate with a `table_overflow` warning.

### Not yet supported

Link reference definitions, HTML inline / blocks, math, custom syntax extensions.

## Streaming identity

`materialize()` uses a `WeakMap`-backed snapshot cache that preserves object identity across frames. The following mutations preserve or correctly invalidate cached snapshots:

- **Tables** — cell, row, and table reference stability across new row appends.
- **Citation references** — the `resolved` flag mutates in place when a matching definition arrives; `materialize()` produces a fresh snapshot wrapper.
- **Task list items** — `task.checked` changes produce fresh snapshots.
- **Citations Map** — iterated in insertion order; each entry is a `CitationDefinition` with stable `id`, `index`, `children`, and `status`.

This means downstream `React.memo` / `OnPush` change detection only re-renders subtrees that actually changed.

## Node shape

```ts
interface MarkdownNodeBase {
  readonly id: number;                                // stable identity, never changes
  readonly type: MarkdownNodeType;                    // 'document' | 'paragraph' | 'heading' | ...
  status: 'pending' | 'streaming' | 'complete';
  parent: MarkdownNode | null;
  index: number | null;                               // index in parent's children array
}
```

Container nodes have `children` typed to whatever they're allowed to contain (e.g., `MarkdownDocumentNode.children: MarkdownBlockNode[]`, `MarkdownParagraphNode.children: MarkdownInlineNode[]`). Scalar leaves carry their content directly (e.g., `MarkdownTextNode.text`, `MarkdownCodeBlockNode.text`).

Type guards for narrowing:

```ts
import {
  isDocumentNode, isParagraphNode, isHeadingNode, isBlockquoteNode,
  isListNode, isListItemNode, isCodeBlockNode, isThematicBreakNode,
  isTableNode, isTableRowNode, isTableCellNode,
  isTextNode, isEmphasisNode, isStrongNode, isStrikethroughNode,
  isInlineCodeNode, isLinkNode, isAutolinkNode, isImageNode,
  isSoftBreakNode, isHardBreakNode,
  isCitationReferenceNode, isCompleteNode,
} from '@cacheplane/partial-markdown';
```

## Common patterns

### Render a streaming response

```ts
const parser = createPartialMarkdownParser();

for await (const chunk of llmStream) {
  parser.push(chunk);
  render(parser.root);   // node identity stable across calls — safe for keyed renders
}

parser.finish();
```

### Iterate top-level blocks

```ts
parser.push(chunk);
for (const block of parser.root?.children ?? []) {
  if (block.type === 'heading') { /* ... */ }
}
```

### Look up a citation

```ts
const def = parser.root?.citations.get('src1');
if (def && def.status === 'complete') {
  // def.children is the resolved citation body
}
```

### Detect end of document

```ts
if (parser.root?.status === 'complete') {
  // safe to materialize and discard
}
```

## API reference

```ts
// Push-style
createPartialMarkdownParser(): PartialMarkdownParser

interface PartialMarkdownParser {
  push(chunk: string): ParseEvent[];
  finish(): ParseEvent[];
  readonly root: MarkdownDocumentNode | null;
  getByPath(path: string): MarkdownNode | null;   // JSON Pointer (RFC 6901)
}

materialize(node: MarkdownNode): /* plain JS snapshot */;

// Pull-style
create(): StreamState;
push(state: StreamState, chunk: string): StreamState;
finish(state: StreamState): StreamState;
resolve(state: StreamState): /* parsed tree */;

// Type guards
isDocumentNode, isParagraphNode, isHeadingNode, isBlockquoteNode,
isListNode, isListItemNode, isCodeBlockNode, isThematicBreakNode,
isTableNode, isTableRowNode, isTableCellNode,
isTextNode, isEmphasisNode, isStrongNode, isStrikethroughNode,
isInlineCodeNode, isLinkNode, isAutolinkNode, isImageNode,
isSoftBreakNode, isHardBreakNode,
isCitationReferenceNode, isCompleteNode

// Types
MarkdownNode, MarkdownDocumentNode, MarkdownBlockNode, MarkdownInlineNode,
MarkdownParagraphNode, MarkdownHeadingNode, MarkdownBlockquoteNode,
MarkdownListNode, MarkdownListItemNode, MarkdownCodeBlockNode,
MarkdownThematicBreakNode, MarkdownTableNode, MarkdownTableRowNode,
MarkdownTableCellNode, MarkdownCitationReferenceNode,
MarkdownTextNode, MarkdownEmphasisNode, MarkdownStrongNode,
MarkdownStrikethroughNode, MarkdownInlineCodeNode, MarkdownLinkNode,
MarkdownAutolinkNode, MarkdownImageNode, MarkdownSoftBreakNode,
MarkdownHardBreakNode,
StreamStatus, StreamState, StreamError, ParseEvent, ParseEventType,
MarkdownWarning, Alignment, CitationDefinition
```

## License

MIT
