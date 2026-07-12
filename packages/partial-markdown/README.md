# @cacheplane/partial-markdown

Streaming Markdown parser for incomplete input.

Use it when an AI model, agent, editor, or network stream emits Markdown a
chunk at a time. Standard Markdown parsers are built around complete documents.
This parser gives you a typed Markdown tree while the document is still
arriving, and keeps node object identity stable as later chunks update the tree.

## Install

```bash
npm install @cacheplane/partial-markdown
```

Runtime and packaging:

- Node `>=20`
- TypeScript declarations included
- ESM and CJS bundled
- Zero runtime dependencies
- Marked side-effect free

## 30-Second Example

```ts
import { createPartialMarkdownParser } from '@cacheplane/partial-markdown';

const parser = createPartialMarkdownParser();

parser.push('# Hello\n\nThis is **bold');
parser.push('** text.');
parser.finish();

const heading = parser.getByPath('/children/0');
const paragraph = parser.getByPath('/children/1');

console.log(heading);
// { type: 'heading', level: 1, status: 'complete', ... }

console.log(paragraph);
// { type: 'paragraph', status: 'complete', children: [...] }
```

The parser does not throw just because the input ends mid-emphasis, mid-list,
mid-table, or mid-line. Every public node carries
`status: 'pending' | 'streaming' | 'complete'`, so a UI can render what exists
now and let nodes resolve in place.

## When To Use It

Use `@cacheplane/partial-markdown` when you need to:

- Render streamed LLM answers without reparsing the whole document on each
  chunk.
- Build chat, report, agent-log, notebook, or editor views over partial
  Markdown.
- Preserve React, Angular, Solid, or custom renderer memoization across chunks.
- Track citations, task lists, and tables as model output grows.
- Convert a live parser tree into plain JS snapshots without replacing
  unchanged subtrees.

It is not a full CommonMark compliance suite. It intentionally supports the
Markdown constructs most useful for AI-generated content and developer-facing
renderers.

## Mental Model

The parser builds one canonical public Markdown node graph. Nodes are mutated in
place as more input arrives, including optimistic open-line projections. Each
node has:

- `id`: nonnegative numeric identity that is unique among live nodes.
- `type`: Markdown node type.
- `status`: `pending`, `streaming`, or `complete`.
- `parent`: parent node or `null`.
- `index`: sibling index for most nodes.

Document, block, and inline container nodes expose `children`. Leaf nodes expose
their content directly, such as `text`, `url`, `language`, or `alt`.

The document root also exposes:

```ts
citations: Map<string, CitationDefinition>
linkDefinitions: Map<string, LinkDefinition>
```

Citation and link-reference definitions are lifted out of the visible block
tree and stored on the root.

Continuing nodes keep their IDs. During an explicit same-operation grammar
reinterpretation, a replacement may inherit the retired node's ID only after
the old incarnation completes. Independent parser instances need not assign
matching IDs, so do not use numeric IDs as a cross-parser identity contract.

## Push-Style API

Use the push-style API for streaming UIs and long-lived node references.

```ts
import {
  createPartialMarkdownParser,
  materialize,
} from '@cacheplane/partial-markdown';

const parser = createPartialMarkdownParser();

for await (const chunk of llmStream) {
  const events = parser.push(chunk);

  for (const event of events) {
    if (event.type === 'value-updated') {
      // This is the canonical node object also exposed through parser.root.
    }
  }

  const snapshot = materialize(parser.root);
  render(snapshot);
}

parser.finish();
```

`push(chunk)` and `finish()` return `ParseEvent[]`:

```ts
interface ParseEvent {
  type: 'node-created' | 'value-updated' | 'node-completed';
  node: MarkdownNode;
  delta?: string;
}
```

Events and `parser.root` share the same canonical node objects; the parser does
not create a separate event-only projection graph. When an open-line projection
matches the committed parse, its node objects carry through to the committed
tree instead of being replaced. A `node-completed` event can refer to a node
that has just been retired by structural replacement; events for live nodes
refer to the objects reachable from the current root.

Event order is deterministic. Retired-node completions are emitted before
creations, then value updates; traversal within those phases is stable tree
order. Status-only completions for retained nodes are emitted in pre-order.

### Path Lookup

`getByPath()` accepts JSON Pointer-like paths over `children`:

```ts
parser.getByPath('');                    // root
parser.getByPath('/children/0');         // first top-level block
parser.getByPath('/children/1/children/0');
```

Missing paths return `null`.

## Pull-Style API

Use the pull-style API when you want immutable parser state, such as reducers,
undo/redo stacks, deterministic tests, or state-machine integrations.

```ts
import { create, push, finish, resolve } from '@cacheplane/partial-markdown';

let state = create();
state = push(state, '# Title\n\nParagraph');
state = finish(state);

const tree = resolve(state);
```

Each call returns a new `StreamState`. Pull-style state also exposes parser
warnings through `state.warnings`.

## Structural-Sharing Snapshots

`materialize(node)` converts the canonical parser node graph into a plain
JavaScript object graph. It uses a `WeakMap` cache keyed by node identity, so
unchanged subtrees return the same materialized object reference across calls.
When a canonical node changes in place, that node and the affected ancestor
path are rematerialized while unrelated subtrees retain their references.

```ts
const before = materialize(parser.root);

parser.push('\n- New item');

const after = materialize(parser.root);
```

This is useful when rendering every animation frame or every stream chunk.
Consumers that compare references only re-render subtrees that actually changed.

## Supported Syntax

### Block-Level

- Documents
- Paragraphs
- ATX headings, `#` through `######`
- Blockquotes
- Unordered lists: `-`, `*`, `+`
- Ordered lists: `1.`
- Task lists: `- [x]`, `- [ ]`
- Fenced code blocks
- Indented code blocks
- Thematic breaks
- GFM tables
- Pandoc-style citation definitions
- Link reference definitions
- Display math: `$$..$$` and `\[..\]`
- Raw HTML blocks

### Inline

- Text
- Emphasis: `*x*`, `_x_`
- Strong: `**x**`, `__x__`
- Strikethrough: `~~x~~`
- Inline code
- Links
- Autolinks
- Images
- Soft and hard line breaks
- Citation references
- Link references: `[text][label]`, `[label][]`, and `[label]`
- Inline math: `$..$` and `\(..\)`
- Raw HTML tags, comments, declarations, processing instructions, and CDATA

## AI-Friendly Markdown Behavior

LLM Markdown is useful but rarely pristine. The parser is intentionally tolerant
where AI output commonly differs from strict Markdown expectations.

### Nested Lists

Nested list items are recognized when their marker is indented at least 2
columns past the parent's marker column or content column, whichever is more
permissive.

```md
- Item 1
  - Sub 1.1
  - Sub 1.2
    - Sub 1.2.1
- Item 2
```

Tabs advance to the next 4-column tab stop. Mixed tabs and spaces are supported.
Each `MarkdownListNode` exposes advisory `markerCol` and `contentCol` fields for
layout-aware consumers.

### Tables

```md
| Header | Aligned |
| :---   | ---:    |
| left   | right   |
```

The alignment row is consumed and not retained as a node. Alignment data is
stored on `MarkdownTableNode.alignments`. Body rows shorter than the header are
padded; overflow rows are truncated and produce a `table_overflow` warning in
pull-style state.

### Citations

```md
Some claim.[^src1]

[^src1]: Source title <https://example.com>
```

Citation references become `citation-reference` inline nodes. Definitions are
lifted into `root.citations`. References use 1-based indices in first-touch
order. If a definition arrives after a reference, the existing reference node
flips `resolved` from `false` to `true` in place.

### Link References

```md
Read [the guide][docs] or [docs].

[docs]: https://example.com "Docs"
```

Full, collapsed, and shortcut reference links become `link-reference` inline
nodes. Definitions are lifted into `root.linkDefinitions` and keyed by
normalized label. If a definition arrives after a reference, the existing
reference node mutates in place with `resolved: true`, `url`, and `title`.

### Math

```md
Inline math uses $a+b$ or \(a+b\).

$$
\sum_i x_i
$$
```

Inline math becomes `math-inline` nodes with opaque `text` and a `delimiter`
field. Inline math is recognized when its containing line is committed, which
matches the parser's existing line-buffered inline parsing model.

> **Note:** Inline math (`$..$`, `\(..\)`) is committed when the containing
> line completes — inline nodes are born with `status: 'complete'`. Display
> math (`$$..$$`, `\[..\]`) streams character-by-character with the full
> `streaming → complete` arc and preserves node identity across pushes.

Display math becomes `math-display` block nodes. `$$..$$` and `\[..\]`
delimiter families are enabled by default and can be disabled independently:

```ts
const parser = createPartialMarkdownParser({
  math: { dollar: false, bracket: true },
});
```

### Raw HTML

```md
Use <kbd>Esc</kbd>.

<details>
<summary>More</summary>
Raw HTML is captured as authored.
```

Inline HTML becomes `html-inline` nodes with `raw` source. HTML blocks become
`html-block` nodes with `raw` source and `htmlKind`, the CommonMark block kind
that opened the node.

### Security — sanitize before rendering

`raw` is unsanitized HTML source. Rendering it directly via
`dangerouslySetInnerHTML` (or any equivalent) is an XSS risk for untrusted
model output. Sanitize first:

```tsx
import DOMPurify from 'dompurify';

if (node.type === 'html-block' || node.type === 'html-inline') {
  return (
    <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(node.raw) }} />
  );
}
```

For untrusted streaming output where you cannot guarantee sanitization at
every render, render HTML nodes as escaped text instead:

```tsx
if (node.type === 'html-block' || node.type === 'html-inline') {
  return <code>{node.raw}</code>;
}
```

Server-side / Node consumers can use [`sanitize-html`](https://www.npmjs.com/package/sanitize-html)
or [`rehype-sanitize`](https://github.com/rehypejs/rehype-sanitize) for the
same purpose.

## Guarantees

`@cacheplane/partial-markdown` guarantees:

- Truncated Markdown is parseable as in-progress input.
- Push-style events and `parser.root` expose one canonical public node graph.
- Public push-style node object identity is stable across pushes, including
  when a matching projected node commits.
- Numeric node IDs are nonnegative and unique among live nodes; continuing
  nodes keep their IDs. During an explicit same-operation grammar
  reinterpretation, a replacement may inherit the retired node's ID only after
  the old incarnation completes. Independent parser instances need not assign
  matching IDs.
- Event ordering is deterministic, with replacement completions before
  creations and updates.
- Node status uses the same `pending | streaming | complete` lifecycle as
  `@cacheplane/partial-json`.
- `materialize()` preserves references for unchanged subtrees.
- Citation references keep stable identity when their `resolved` flag changes.
- Link references keep stable identity when their `resolved`, `url`, or `title`
  fields change.
- Display math block nodes keep stable identity as their text grows line by
  line.
- HTML block nodes keep stable identity as `raw` grows line by line.
- Task-list item nodes keep stable identity when checked state changes.
- Table, row, and cell references stay stable when later rows arrive.
- Citation definitions are stored in insertion order by first-touch citation
  index.
- Link definitions are stored in normalized-label insertion order.

## Limits

This package does not currently support:

- Multi-line link definition titles
- Link definitions inside list items
- Raw HTML blocks inside blockquotes or list items
- Custom Markdown extensions
- Full CommonMark compliance

For unsupported syntax, prefer rendering the raw text node content or applying a
separate post-processing pass after the stream is complete.

## Warning Model

Pull-style `StreamState` includes `warnings: MarkdownWarning[]`.

Current warning codes:

```ts
'unterminated_construct'
'unmatched_closer'
'invalid_link'
'unknown_construct'
'unresolved_citation_ref'
'unused_citation_def'
'duplicate_citation_def'
'table_overflow'
'malformed_table_alignment'
'unresolved_link_ref'
'unused_link_def'
'duplicate_link_def'
'unterminated_math'
'unterminated_html'
```

Warnings are intended for diagnostics, logging, and optional UI affordances.
They are not thrown as exceptions.

## Node Shape

```ts
interface MarkdownNodeBase {
  readonly id: number;
  readonly type: MarkdownNodeType;
  status: 'pending' | 'streaming' | 'complete';
  parent: MarkdownNode | null;
  index: number | null;
}
```

Container nodes have typed `children` arrays:

```ts
interface MarkdownDocumentNode extends MarkdownNodeBase {
  readonly type: 'document';
  children: MarkdownBlockNode[];
  citations: Map<string, CitationDefinition>;
  linkDefinitions: Map<string, LinkDefinition>;
}

interface MarkdownParagraphNode extends MarkdownNodeBase {
  readonly type: 'paragraph';
  children: MarkdownInlineNode[];
}

interface MarkdownListNode extends MarkdownNodeBase {
  readonly type: 'list';
  ordered: boolean;
  start: number | null;
  tight: boolean;
  markerCol: number;
  contentCol: number;
  children: MarkdownListItemNode[];
}
```

Leaf nodes carry direct content:

```ts
interface MarkdownTextNode extends MarkdownNodeBase {
  readonly type: 'text';
  text: string;
}

interface MarkdownCodeBlockNode extends MarkdownNodeBase {
  readonly type: 'code-block';
  variant: 'fenced' | 'indented';
  language: string;
  text: string;
}

interface MarkdownMathDisplayNode extends MarkdownNodeBase {
  readonly type: 'math-display';
  text: string;
  delimiter: '$$' | '\\[\\]';
}

interface MarkdownHtmlBlockNode extends MarkdownNodeBase {
  readonly type: 'html-block';
  raw: string;
  htmlKind: 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

interface MarkdownMathInlineNode extends MarkdownNodeBase {
  readonly type: 'math-inline';
  text: string;
  delimiter: '$' | '\\(\\)';
}

interface MarkdownHtmlInlineNode extends MarkdownNodeBase {
  readonly type: 'html-inline';
  raw: string;
}

interface MarkdownImageNode extends MarkdownNodeBase {
  readonly type: 'image';
  url: string;
  title: string;
  alt: string;
}
```

Citation definitions:

```ts
interface CitationDefinition {
  id: string;
  index: number;
  children: MarkdownInlineNode[];
  status: 'pending' | 'streaming' | 'complete';
}
```

Link definitions:

```ts
interface LinkDefinition {
  id: string;
  label: string;
  url: string;
  title: string;
  status: 'pending' | 'streaming' | 'complete';
}
```

## Type Guards

```ts
import {
  isDocumentNode,
  isParagraphNode,
  isHeadingNode,
  isBlockquoteNode,
  isListNode,
  isListItemNode,
  isCodeBlockNode,
  isMathDisplayNode,
  isHtmlBlockNode,
  isThematicBreakNode,
  isTableNode,
  isTableRowNode,
  isTableCellNode,
  isTextNode,
  isEmphasisNode,
  isStrongNode,
  isStrikethroughNode,
  isInlineCodeNode,
  isMathInlineNode,
  isHtmlInlineNode,
  isLinkNode,
  isAutolinkNode,
  isImageNode,
  isSoftBreakNode,
  isHardBreakNode,
  isCitationReferenceNode,
  isLinkReferenceNode,
  isCompleteNode,
} from '@cacheplane/partial-markdown';
```

## Common Patterns

### Render A Streaming Response

```ts
const parser = createPartialMarkdownParser();

for await (const chunk of llmStream) {
  parser.push(chunk);
  render(parser.root);
}

parser.finish();
```

### Iterate Top-Level Blocks

```ts
parser.push(chunk);

for (const block of parser.root?.children ?? []) {
  if (block.type === 'heading') {
    renderHeading(block);
  }
}
```

### Render Task Lists

```ts
for (const block of parser.root?.children ?? []) {
  if (block.type !== 'list') continue;

  for (const item of block.children) {
    if (item.task) {
      renderCheckbox(item.task.checked);
    }
  }
}
```

### Look Up A Citation

```ts
const def = parser.root?.citations.get('src1');

if (def && def.status === 'complete') {
  renderCitation(def.index, def.children);
}
```

### Detect End Of Document

```ts
parser.finish();

if (parser.root?.status === 'complete') {
  const tree = materialize(parser.root);
}
```

## Troubleshooting

**`parser.root` is `null`.**
No document root has been created yet. Push a non-empty chunk first.

**A paragraph is still `streaming`.**
The parser may still be holding the current line open. Push a newline or call
`finish()` when the stream ends.

**A citation reference is unresolved.**
The matching definition has not arrived. If the definition later streams in, the
same reference node flips `resolved` to `true`.

**A link reference is unresolved.**
The matching definition has not arrived. If the definition later streams in, the
same reference node flips `resolved` to `true` and receives `url` and `title`.

**A table row has fewer or more cells than expected.**
Rows shorter than the header are padded. Overflow cells are truncated and
reported as `table_overflow` in pull-style warnings.

**A Markdown construct renders as text.**
It may be unsupported syntax. See the limits section above.

**Raw HTML rendered from an LLM is unsafe.**
The parser preserves HTML source but does not sanitize it. Sanitize `raw` before
rendering as HTML, or render it as escaped text for untrusted output.

## API Reference

```ts
// Push-style
createPartialMarkdownParser(options?: PartialMarkdownParserOptions): PartialMarkdownParser

interface PartialMarkdownParser {
  push(chunk: string): ParseEvent[];
  finish(): ParseEvent[];
  readonly root: MarkdownDocumentNode | null;
  getByPath(path: string): MarkdownNode | null;
}

materialize(node: MarkdownNode | null): unknown;

// Pull-style
create(options?: PartialMarkdownParserOptions): StreamState;
push(state: StreamState, chunk: string): StreamState;
finish(state: StreamState): StreamState;
resolve(state: StreamState): unknown;
```

Exported type guards:

```ts
isDocumentNode, isParagraphNode, isHeadingNode, isBlockquoteNode,
isListNode, isListItemNode, isCodeBlockNode, isThematicBreakNode,
isTableNode, isTableRowNode, isTableCellNode,
isTextNode, isEmphasisNode, isStrongNode, isStrikethroughNode,
isInlineCodeNode, isMathInlineNode, isMathDisplayNode,
isHtmlInlineNode, isHtmlBlockNode,
isLinkNode, isAutolinkNode, isImageNode,
isSoftBreakNode, isHardBreakNode,
isCitationReferenceNode, isLinkReferenceNode, isCompleteNode
```

Exported types:

```ts
MarkdownNode, MarkdownDocumentNode, MarkdownBlockNode, MarkdownInlineNode,
MarkdownParagraphNode, MarkdownHeadingNode, MarkdownBlockquoteNode,
MarkdownListNode, MarkdownListItemNode, MarkdownCodeBlockNode,
MarkdownMathDisplayNode,
MarkdownHtmlBlockNode,
MarkdownThematicBreakNode, MarkdownTableNode, MarkdownTableRowNode,
MarkdownTableCellNode, MarkdownCitationReferenceNode,
MarkdownLinkReferenceNode,
MarkdownTextNode, MarkdownEmphasisNode, MarkdownStrongNode,
MarkdownStrikethroughNode, MarkdownInlineCodeNode, MarkdownMathInlineNode,
MarkdownHtmlInlineNode,
MarkdownLinkNode,
MarkdownAutolinkNode, MarkdownImageNode, MarkdownSoftBreakNode,
MarkdownHardBreakNode,
StreamStatus, StreamState, StreamError, ParseEvent, ParseEventType,
MarkdownWarning, Alignment, CitationDefinition, LinkDefinition,
PartialMarkdownParserOptions, ResolvedParserOptions,
AstNode, AstNodeKind, ParseMode, HtmlBlockKind
```

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md).

## License

MIT
