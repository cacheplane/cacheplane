# Changelog

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
