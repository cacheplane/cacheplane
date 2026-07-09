# Blockquote Table Parsing Design

## Goal

Support GitHub-style markdown tables inside blockquotes in `@cacheplane/partial-markdown`, including streaming projection for partial table rows, without regressing the existing root-level table behavior.

## Current State

The parser already projects partial root-level table rows into the active table and suppresses streamed code-fence closers. The remaining gap is documented by a skipped test: quoted table rows such as `> | A | B |` and `> | --- | --- |` are parsed as blockquote paragraphs instead of a table nested in the blockquote.

## Proposed Architecture

Make table construction parent-aware. Today table nodes are always attached to the document root. The fix should derive the current block parent from the parser stack, so a table opened while a blockquote is active is appended to that blockquote.

Blockquote handling should continue to strip the `>` prefix, but it should route the inner line through the same block recognizers used at the root. That lets table lookahead, table body rows, and optimistic table projection share the existing parser path instead of adding a quote-specific table parser.

## Data Flow

1. A quoted line enters `openOrExtendBlockquote`.
2. The parser opens or reuses the active blockquote container.
3. The stripped inner line is processed as block content under that blockquote.
4. Table header lookahead, alignment promotion, and body-row appends use the active blockquote as their parent.
5. When a non-table line appears, the nested table closes before regular blockquote paragraph handling continues.

## Testing

Add failing tests first:

- A complete quoted table commits as a `table` child inside a `blockquote`.
- A streamed partial quoted body row projects into the same nested table.
- A blockquote followed by a root-level table remains two root siblings, not a nested table.

Then run the focused parser suites plus the package test suite if the local pnpm policy allows it. If pnpm install policy blocks the package script, run the local Vitest binary directly and report that limitation.

## Non-Goals

Do not redesign list nesting, HTML block handling, or markdown compatibility beyond the blockquote/table path. Do not add consumer-side adapters for Angular; the parser should emit the correct tree upstream.
