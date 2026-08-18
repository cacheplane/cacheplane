# Changelog

## 0.5.10 — 2026-08-18

### Added

- Plain `http://`, `https://`, `www.`, and email text now parses as GFM-style
  autolink literals, including inside citation definitions.
- Trailing sentence punctuation and unmatched closing parentheses remain
  outside autolinks.

## 0.5.9 — 2026-08-11

### Performance

- Long open paragraphs now avoid repeated generic scalar snapshots and full
  structural-prefix scans on each plain-text character.
- Character-streamed block prefixes continue to fall back to the full parser
  as soon as headings, lists, tables, math, fences, or HTML become decisive.

## 0.5.8 — 2026-07-11

### Changed

- **Push-style projection now has one canonical root and event graph.** Events
  reference the same public node objects exposed through `parser.root`, without
  synthetic negative-ID nodes or partial delimiter text leaking into the live
  tree. Matching projected nodes retain their object identity when committed.
- **Event ordering is deterministic.** Replaced nodes complete before new nodes
  are created, followed by updates, with stable tree-order traversal within
  each phase.
- **Public numeric IDs identify live nodes.** IDs are nonnegative and unique
  among live nodes, and continuing nodes keep their IDs. During an explicit
  same-operation grammar reinterpretation, a replacement may inherit the
  retired node's ID only after the old incarnation completes. Independent
  parser instances need not assign matching IDs.

### Fixed

- **Display-math projections update the canonical node immediately.** Streaming
  display-math text is visible on the existing public node as each chunk
  arrives, while that same object proceeds to completion.

### Performance

- Added incremental fast-path guards for long plain-text and punctuation-heavy
  open lines, including leading-pipe input, to prevent repeated full-line
  projection work while preserving structural fallback when Markdown becomes
  decisive.

## 0.5.7 — 2026-07-09

### Fixed

- **Tables now parse inside blockquotes.** Quoted markdown tables such as
  `> | A | B |` followed by a quoted alignment row now commit as table
  children inside the blockquote instead of falling back to paragraph text.
- **Streaming quoted table rows stay nested.** Partial body rows streaming
  inside a blockquote project into the existing nested table, preserving the
  same table-row behavior available at the document root.

## 0.5.6 — 2026-07-07

### Fixed

- **Closing code fences no longer flash inside streaming code blocks.** Partial
  closer prefixes such as `` ` `` and `` `` `` are suppressed during optimistic
  projection, and active fenced code blocks now track their opener marker
  separately from the pending line buffer.
- **Tilde fenced blocks keep backtick-only lines as code content.** Fence closer
  matching now uses the remembered opener marker instead of the current line.

## 0.5.5 — 2026-07-07

### Fixed

- **Blockquote content now stays nested in the blockquote.** Streaming quoted
  paragraphs no longer materialize as an empty blockquote followed by a sibling
  paragraph.
- **Nested open-line projection now updates changed descendants.** Open lines
  inside blockquotes are projected into the nested paragraph instead of reusing
  a stale top-level container snapshot.

## 0.5.4 — 2026-07-06

### Changed

- **Active table rows no longer require a trailing pipe.** Once a table is
  established, a following leading-pipe row now remains part of that table even
  if the row is finalized before a closing `|` arrives. This keeps paused or
  finalized streams from ejecting an in-progress body row into a raw-pipe
  paragraph below the table.

## 0.5.3 — 2026-07-05

### Added

- **Streaming table body rows.** While a table is active, an in-progress body
  row on the open line now renders as a streaming row inside the table —
  growing cell-by-cell, padded to header width — instead of momentarily
  closing the table and flashing as a raw-pipe paragraph (bare `|` / one pipe)
  or a spurious second header-only table (two+ pipes). A bare `|` projects as
  an empty in-progress row. Projection-only: the committed parse is unchanged.
  Completes the streaming-table work begun in 0.5.2.

## 0.5.2 — 2026-06-25

### Added

- **Streaming table headers.** A table header now renders as a growing,
  header-only table the moment the first cell closes on the open line
  (`| Name |` → a 1-row table; columns and cell text fill in as tokens arrive),
  instead of blanking out and reappearing as raw pipe text before snapping into
  a table. This closes the most visible remaining streaming artifact for
  token-by-token (LLM) output. Projection-only: the committed parse is unchanged
  and a header with no delimiter row still finishes as a CommonMark paragraph.

## 0.5.1 — 2026-06-24

### Added

- **Optimistic mid-construct rendering on the open line.** Building on 0.5.0's
  streaming open-line projection, an *unterminated* inline construct now renders
  as its in-progress node instead of a literal marker: `**bold` → an in-progress
  `strong`, `_em` → `emphasis`, `` `code `` → `inline-code` — spanning to the end
  of the open line and flipping to the real (closed) construct when the closer
  streams in. A left-flanking guard (content must immediately follow the opener)
  keeps `2 * 3` and a trailing `**` literal, avoiding spurious emphasis.

  This affects **only** the open (streaming) line. The committed/finished path is
  unchanged and stays CommonMark-correct (an unterminated `**bold` in a finished
  document is still literal text). Chunk-invariance + fuzz suites unaffected.

## 0.5.0 — 2026-06-24

### Changed

- **Streaming open-line rendering (B.2).** `parser.root` now includes the open
  (unterminated) line — the text after the last newline — parsed and grafted on
  with `status: 'streaming'`, so consumers render in-progress content instead of
  waiting for a newline. The open line continues the last open paragraph when
  appropriate, or starts a new streaming block after a blank line. On `finish()`
  (or once a newline commits the line) it becomes a normal `complete` node.

  Committed blocks keep their referential identity across pushes; only the
  changing open-line region is re-projected. This is a behavior change for
  consumers that previously relied on the open line being buffered/hidden until
  a newline. Note: an *unterminated* inline construct (e.g. `**bold` before its
  closing `**`) still renders its literal marker until the closer arrives, then
  snaps to formatted — fully optimistic mid-construct rendering is future work.

## 0.4.2 — 2026-06-22

### Added

- **Backslash-escape handling for inline punctuation (B.1).** A backslash
  before an ASCII-punctuation character now renders the **literal character**
  with the backslash dropped, and the escaped character does **not** trigger
  its markdown construct: `\*not bold\*` → `*not bold*`, `\_x\_` → `_x_`,
  `\$5` → `$5`, `` \` `` → a literal backtick, `\#` → `#`, `\\` → a single
  backslash. Escaped delimiters are also skipped when matching emphasis
  closers, so `*a\*b*` is emphasis containing the literal `a*b`.
- The four bracket characters `( ) [ ]` are excluded from escaping while
  `math.bracket` is enabled (the default), so the `\(…\)` / `\[…\]` math
  delimiters keep working. When `math.bracket` is disabled, those brackets
  follow CommonMark and become escapable too.

### Fixed

- **O(n²) inline parsing on long single-token runs.** A line of many unmatched
  `` ` ``, `[`, or `!` characters previously re-scanned the rest of the line for
  each one (quadratic; a 20 k-char run took seconds). Unmatched backtick runs
  now emit in one step, and `[`/`!` are only treated as construct openers when a
  `]` follows — making these inputs linear. Output is unchanged for real content.

## 0.4.1 — 2026-05-07

### Fixed

- **HTML inline pending buffer.** `htmlInlinePending` is now actually used
  for unterminated inline HTML state. When `finish()` is called with
  partial inline HTML (e.g., `<spa` with no closing newline), the bytes
  are flushed as a plain text node attached to the open paragraph and
  the `unterminated_html` warning is emitted. Previously the bytes were
  silently dropped.
- **Math `$$` opener escape ordering.** `isMathOpenerAt` now checks the
  backslash escape *before* the `$$` short-circuit, so `\$$` correctly
  declines to open a display-math block.

### Changed (test-only)

- Math provider tests realigned with provider-native delimiter styles:
  `provider-openai.test.ts` uses `\(..\)` / `\[..\]` (GPT style);
  `provider-gemini.test.ts` uses `$..$` / `$$..$$` (Gemini style).
  Production behavior unchanged.

### Documentation

- README HTML security section now includes a DOMPurify code example and
  an alternative escaped-text rendering pattern.
- Math design spec gains an "Implementation note" subsection clarifying
  that 0.4.0 inline math is line-buffered (born `complete`); display math
  retains the full `streaming → complete` arc. Tracked for 0.5.0.
- HTML design spec updated to reflect the implementation's `htmlKind`
  field name (renamed from `kind` to avoid AST-discriminant collision).
- `ParseEvent.delta` JSDoc clarifies which event kinds carry `delta` and
  which flag-mutation events do not.
- `liftLinkDef` and `makeLinkReference` now carry comments explaining
  the empty-array-sentinel pattern used by `unused_link_def` detection.

### Tests

- New: HTML cross-`push()` mid-tag boundary, buffer-overflow flush,
  finish-time flush with text-node assertion, `<img onerror=...>` XSS
  regression, kind-2 comment chunk-split, kind-6 full-tag-list assertion
  (62 tags), inline HTML in link text and table cells, HTML NOT parsed
  inside inline code spans.
- New: math currency E2E paragraph-tree assertions, closer-adjacency
  chunk boundary (`$x ‖ $`), math in heading / link / table cell / list
  item, escaped-`$$` opener.
- New: link-ref partition equivalence in `chunk-boundary-link-refs.test.ts`,
  `unused_link_def` absence on resolved refs, angle-bracket URL form.

## 0.4.0 — 2026-05-07

### Added

- Streaming-aware CommonMark link reference support for full (`[text][label]`),
  collapsed (`[label][]`), and shortcut (`[label]`) forms.
- Link reference definitions are lifted into
  `MarkdownDocumentNode.linkDefinitions: Map<string, LinkDefinition>`.
- Forward resolution mutates existing `link-reference` nodes in place when a
  matching definition arrives later in the stream.
- New `MarkdownLinkReferenceNode`, `LinkDefinition`, and
  `isLinkReferenceNode` exports.
- Inline math support for `$..$` and `\(..\)` via `math-inline` nodes.
- Display math support for `$$..$$` and `\[..\]` via `math-display` block
  nodes.
- Parser options for disabling dollar or bracket math delimiter families.
- New `MarkdownMathInlineNode`, `MarkdownMathDisplayNode`,
  `PartialMarkdownParserOptions`, `isMathInlineNode`, and
  `isMathDisplayNode` exports.
- Raw HTML support for CommonMark-style inline HTML and top-level HTML blocks.
- New `MarkdownHtmlInlineNode`, `MarkdownHtmlBlockNode`, `HtmlBlockKind`,
  `isHtmlInlineNode`, and `isHtmlBlockNode` exports.
- New warning codes: `unresolved_link_ref`, `unused_link_def`, and
  `duplicate_link_def`.
- New warning code: `unterminated_math`.
- New warning code: `unterminated_html`.

### Notes for upgraders

- `MarkdownDocumentNode` now has a required `linkDefinitions` Map. Existing
  code constructing this type manually must initialize the Map.
- Exhaustive `type` switches over inline nodes need `link-reference`,
  `math-inline`, and `html-inline` cases. Exhaustive block-node switches need
  `math-display` and `html-block` cases.
- Math is enabled by default. Consumers that treat dollar-bracket text
  literally can pass
  `createPartialMarkdownParser({ math: { dollar: false, bracket: false } })`.
- Inline math is recognized when its containing line is committed.
- HTML `raw` is unsanitized source. Consumers rendering untrusted model output
  as HTML must sanitize or escape it.
- Top-level HTML blocks are supported in this slice; raw HTML blocks inside
  blockquotes or list items remain unsupported.
- Multi-line link definition titles remain unsupported and are parsed as
  regular paragraph content after the first line.

## 0.3.2 — 2026-05-06

### Fixed

- `finish()` now flushes a pending `lineBuffer` before closing containers.
  Previously, single-chunk input with no trailing newline (e.g. `'hello'`,
  `'# heading'`, `'- item'`, `'> quote'`) produced an empty document tree
  because `push()` only processes lines that end with `\n` and `finish()`
  closed open containers without running the buffered line through the
  block handler. Bug existed since 0.2.0 — surfaced only with LLM responses
  that don't terminate with a newline.

## 0.3.1 — 2026-05-06

Infrastructure-only release. No behavior changes; verifies the monorepo's
tag-routed publish pipeline.

## 0.3.0 — 2026-05-05

### Added

- **Indent-aware nested list parsing.** Sub-items are now recognized when their
  marker is indented ≥ 2 columns past the parent's marker column, or past the
  parent's `contentCol` — whichever condition is met first. This fixes the
  live-Chrome smoke bug where `- Item 1\n  - Sub item 1.1` produced 4 sibling
  list-items instead of a properly nested structure.
- **3-deep (and deeper) nesting** works, with correct sibling-extend on dedent.
- **Tab normalization**: tabs advance to the next 4-column tab stop, consistent
  with CommonMark. Mixed tabs + spaces are supported.
- **Lazy continuation**: a non-marker line indented past the current item's
  `contentCol` is appended as inline content to that item's open paragraph.
- **`markerCol` / `contentCol` advisory fields** on `MarkdownListNode` (and
  internal `ListAstNode`). Consumers who do not care about layout can ignore
  them.
- **`listStack`** field on `InternalState` — tracks each open list's geometry
  through the full nesting depth.
- `measureLine(line)` exported from `src/internals.ts` for measuring leading
  indentation (column-accurate with tab stops) and detecting list markers.

### Changed

- **`MarkdownNodeStatus` renamed to `StreamStatus`** to match
  `@cacheplane/partial-json@0.2.0`. Both packages export structurally identical
  tristate types. Update import aliases accordingly.
- Blank lines inside lists now close all open nested lists (not just the
  innermost), matching GFM behaviour.
- `ListAstNode` now requires `markerCol` and `contentCol` fields. Any code
  constructing `ListAstNode` values directly must be updated.

### Notes for upgraders

- Replace `MarkdownNodeStatus` with `StreamStatus` at all import sites.
- `MarkdownListNode.markerCol` and `MarkdownListNode.contentCol` are new
  required fields; TypeScript will surface missing-field errors on manual
  construction.
- Existing flat lists (no indentation) continue to produce flat ASTs — the
  nested-list detection only fires when relative indent ≥ 2 columns.

## 0.2.0 — 2026-05-04

### Added

- Pandoc footnote-style citations: `[^id]` inline references and `[^id]: ...` block-level definitions.
- `DocumentNode.citations: Map<string, CitationDefinition>` sidecar.
- `CitationReferenceNode` with `refId`, parser-assigned 1-based `index`, and `resolved` flag.
- GFM tables: `TableNode`, `TableRowNode`, `TableCellNode` with alignment metadata, ragged-row padding, and code-span-aware cell tokenization.
- GFM task list items via optional `task: { checked: boolean }` on `ListItemNode` / `MarkdownListItemNode`.
- New type guards: `isTableNode`, `isTableRowNode`, `isTableCellNode`, `isCitationReferenceNode`.
- New `Alignment` type alias (`'left' | 'center' | 'right' | null`).
- New `MarkdownWarning` codes: `unresolved_citation_ref`, `unused_citation_def`, `duplicate_citation_def`, `table_overflow`, `malformed_table_alignment`.
- Parse modes extended: `'table'`, `'table-row'`, `'citation-def'`.

### Changed

- `MarkdownDocumentNode` now has a required `citations: Map<...>` field. Existing code constructing this type manually must initialize the Map.
- `MarkdownListItemNode` gains an optional `task` field.
- Materialize fingerprint extended for new node kinds and the citations sidecar.
- `MarkdownNode` union extended with `MarkdownTableRowNode` and `MarkdownTableCellNode` (in addition to `MarkdownTableNode` via `MarkdownBlockNode` and `MarkdownCitationReferenceNode` via `MarkdownInlineNode`).

### Notes for upgraders

- Exhaustive `type` switches over `MarkdownNode['type']` will need new cases. The TypeScript compiler will surface them as missing-case errors.
- The `index` field on `MarkdownCitationReferenceNode` carries the parser-assigned citation index, NOT the sibling position used by other nodes.

## 0.1.0 — initial release

- Streaming Markdown parser with identity preservation, push/pull APIs, JSON Pointer lookups, structural-sharing materialization.
