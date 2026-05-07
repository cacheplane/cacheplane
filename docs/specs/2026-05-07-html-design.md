# HTML (inline + block) — Design

**Status:** Draft
**Date:** 2026-05-07
**Package:** `@cacheplane/partial-markdown`
**Target version:** `0.4.0` (batched with link refs + math)
**Authors:** Brian Love (with Claude)

## Summary

Add streaming-aware support for raw HTML embedded in Markdown — both inline
(`<span>foo</span>`, `<br>`, `<!-- comment -->`) and block (`<div>...</div>`,
`<table>...</table>`, `<script>`) — as **opaque pass-through** nodes. The
parser captures the literal source text into `raw: string`. Tag/attribute
parsing is explicitly out of scope. Sanitization is the consumer's
responsibility.

Detection follows the **CommonMark §4.6 (block) and §6.6 (inline)** rules
exactly. No "loose" detection.

## 0.4.0 Implementation Note

The first implementation follows the parser's current line-buffered
architecture: inline HTML is recognized when its containing line is committed,
and HTML block `raw` grows as content lines are committed. Top-level HTML
blocks are supported in this slice; raw HTML blocks inside blockquotes or list
items require a broader container-block refactor and remain future work.

## Motivation

LLM output frequently contains raw HTML when:
- The user asked for HTML output that includes Markdown narration.
- The model was trained on HTML+Markdown content (Wikipedia-style, MDX).
- The model emits HTML for visual constructs Markdown can't express
  (`<details>`, `<sub>`, `<kbd>`, `<br>`).
- Documentation tools like MDX, Docusaurus, Astro accept HTML inline.

Today, `<div class="warning">` arrives as plain text and renders as escaped
characters. Consumers who use `react-markdown` or `marked` expect HTML to
appear as structural HTML nodes they can sanitize and render. Closing this gap
makes the parser useful for the largest LLM-output use cases we're not yet
covering.

## Goals

- Recognize HTML blocks per all seven CommonMark §4.6 start conditions.
- Recognize inline HTML per CommonMark §6.6 (open tags, close tags, comments,
  PIs, declarations, CDATA).
- Streaming-tolerant: `raw` grows in place character-by-character; status flips
  `streaming → complete` on close-condition match.
- Stable node identity across `push()` calls.
- Faithful preservation of source bytes — no normalization, no whitespace
  stripping, no attribute reordering.
- Diagnostics: warning for unterminated HTML at `finish()`.

## Non-goals

- HTML parsing (tag name lookup, attribute extraction). `raw` is a flat string.
- HTML sanitization. The README will direct consumers to DOMPurify or
  equivalent and warn about XSS risk.
- HTML validation. Malformed HTML is captured verbatim if it satisfies the
  CommonMark detection grammar; otherwise falls through to plain text.
- Recursive Markdown inside HTML blocks. CommonMark says HTML block content is
  NOT parsed as Markdown — we honor that.
- Type-1-block re-entry of Markdown after the HTML block closes. Standard
  CommonMark behavior — once the block closes (blank line / matching close
  tag), the next line is back in normal block mode.

## Design

### Two new AST kinds

Add to `AstNodeKind`:

- `'html-inline'` — inline node, member of `MarkdownInlineNode`.
- `'html-block'` — block node, member of `MarkdownBlockNode`.

### Public types

```ts
export interface MarkdownHtmlInlineNode extends MarkdownNodeBase {
  readonly type: 'html-inline';
  /** Literal HTML source as authored, including angle brackets. */
  raw: string;
}

export interface MarkdownHtmlBlockNode extends MarkdownNodeBase {
  readonly type: 'html-block';
  /** Literal HTML source. May span multiple lines, including blank lines (kind 1). */
  raw: string;
  /** Which CommonMark start condition opened this block. 1..7. Advisory. */
  htmlKind: 1 | 2 | 3 | 4 | 5 | 6 | 7;
}
```

> **Naming note:** the field is `htmlKind` (not `kind`) on the public node.
> The internal AST discriminant uses `kind` for the AST kind name; renaming
> the block-condition number to `htmlKind` avoids the collision.

`MarkdownInlineNode` union gains `MarkdownHtmlInlineNode`.
`MarkdownBlockNode` union gains `MarkdownHtmlBlockNode`.

New type guards: `isHtmlInlineNode`, `isHtmlBlockNode`.

### Detection — HTML blocks (CommonMark §4.6)

Seven start conditions, evaluated in order. The first to match wins.

| Kind | Start condition (line begins with, optionally preceded by ≤3 spaces) | Close condition |
|---|---|---|
| 1 | `<script`, `<pre`, `<style`, or `<textarea` followed by space, tab, `>`, or end-of-line | Line containing `</script>`, `</pre>`, `</style>`, `</textarea>` (case-insensitive). Content includes blank lines. |
| 2 | `<!--` | Line containing `-->`. |
| 3 | `<?` | Line containing `?>`. |
| 4 | `<!` followed by ASCII letter | Line containing `>`. |
| 5 | `<![CDATA[` | Line containing `]]>`. |
| 6 | `<` or `</` followed by one of CommonMark's fixed list of 62 block-level tag names (`<address>`, `<article>`, ..., `<ul>`), then end-of-tag char (space, tab, `>`, `/>`, end-of-line) | Blank line. |
| 7 | A complete open or close tag (any name except `<script>`/`<pre>`/`<style>`/`<textarea>`) that occupies the entire line modulo whitespace, NOT immediately after a non-blank line that opens a paragraph | Blank line. |

CommonMark's exact tag list for kind 6 is fixed; we'll embed it as a constant.

### Detection — inline HTML (CommonMark §6.6)

Inline HTML opens inside an inline content position when the parser sees `<`
followed by one of:

| Pattern | Description |
|---|---|
| Open tag | `<` + tag name + zero-or-more attributes + optional `/` + `>`. |
| Close tag | `</` + tag name + optional whitespace + `>`. |
| Comment | `<!--` + content (no `--`) + `-->`. |
| Processing instruction | `<?` + content + `?>`. |
| Declaration | `<!` + ASCII letter + content + `>`. |
| CDATA | `<![CDATA[` + content + `]]>`. |

Tag name: ASCII letter, then letters/digits/hyphens.
Attribute: name (letter/`_`/`:` followed by letters/digits/`_`/`.`/`:`/`-`),
optionally followed by `=` and a value (unquoted/single-/double-quoted).
Whitespace allowed between attributes.

A `<` that does NOT match any of the above is plain text.

### Streaming semantics

#### Block-level

The block scanner already operates line-by-line — `lineBuffer` accumulates
characters until `\n`. On full-line tests, run through the seven start
conditions in order. If a kind matches:

1. Create `MarkdownHtmlBlockNode` with `kind=N`, `status='streaming'`,
   `raw=<this line + '\n'>`.
2. Switch parser into a new mode: `'html-block-N'` (one mode per kind, since
   close conditions differ).
3. Each subsequent line is appended to `raw` (with `\n` separator) until the
   close condition fires:
   - Kind 1: line contains the matching close tag (case-insensitive).
   - Kinds 2/3/4/5: line contains the closing token.
   - Kinds 6/7: blank line. The blank line itself is NOT included in `raw`.
4. On close, status flips to `complete`; mode returns to `block`.

If `finish()` is called while an HTML block is open:
- Kinds 1-5: emit `unterminated_html` warning, force `complete`.
- Kinds 6/7: close gracefully without warning (these are blank-line-terminated
  and an EOF is treated as a blank line).

#### Inline

Inline detection uses a tentative-match buffer pattern, similar to the
existing tablePending machinery and the math `$..$` machinery proposed in the
math spec.

When the inline scanner sees `<`:
1. Probe forward from current position for one of the six inline patterns.
2. If a complete pattern matches within the current inline buffer:
   - Emit prior text node up to the `<`.
   - Create `MarkdownHtmlInlineNode` with `raw=<the matched bytes>`,
     `status='complete'`.
   - Advance scanner past the match.
3. If the `<` is followed by characters that COULD form one of the patterns
   but the close `>` hasn't arrived yet (chunk boundary):
   - Hold the bytes from `<` onward in the inline buffer; do NOT emit yet.
   - On the next push, retry the probe from the same `<`.
   - If the buffer accumulates content that disqualifies all six patterns
     (e.g., `<` followed by whitespace-then-letter — not a valid tag start),
     flush as plain text immediately.
4. If `finish()` is called with bytes still held: emit `unterminated_html`
   warning and flush as plain text.

A subtle case: `<3` — clearly not a tag start. The probe must reject quickly
to avoid swallowing math/comparison operators.

#### Identity preservation

Block: a `MarkdownHtmlBlockNode` created on first start-condition match is the
SAME object reference for the lifetime of the document. Only `raw` and
`status` mutate.

Inline: an `html-inline` node is created only when the full pattern resolves —
i.e., it is born with `status='complete'`. No streaming-status inline HTML
nodes (the entire match either completes within a single push or is held in
the buffer until it does).

`materialize()` fingerprints block HTML on `(raw.length, status)`.

### Interaction with existing constructs

| Context | Behavior |
|---|---|
| Inside code span / code block | NOT parsed. Existing precedent — code is opaque. |
| Inside link text `[<span>foo</span>](url)` | Inline HTML IS parsed. |
| Inside table cell | Inline HTML IS parsed. Block-level HTML is NOT recognized inside cells (cells are inline contexts). |
| Inside list item | Block HTML at the list-item content column IS recognized. Inline HTML in list-item paragraphs IS parsed. |
| Inside blockquote `> <div>` | Kind 6/7 HTML can appear; kinds 1-5 require the start condition to be at column 0 of the blockquote inner content. |
| HTML block close condition vs. list close on the same blank line | HTML block close wins — the blank line terminates the HTML block first; subsequent block parsing then handles list closure. (CommonMark behavior.) |

### CommonMark kind-7 paragraph-interaction rule

Kind 7 specifically: the start condition does NOT match if the immediately
preceding line was content of an open paragraph. This is the rule that keeps
`Hello\n<a>world</a>` inside the paragraph as inline-HTML rather than starting
a kind-7 block. Implementation must honor this.

### Warnings (new code)

```ts
'unterminated_html'   // emitted at finish() for unterminated kind-1..5 blocks
                      // and unresolved inline-HTML buffer
```

`MarkdownWarning['code']` union extended.

### Parse modes

New `ParseMode` values:

- `'html-block-1'` through `'html-block-7'` (seven modes — different close
  conditions warrant different mode values for clean dispatch). Implementation
  may collapse to one mode plus a `htmlBlockKind: 1..7` field on
  `InternalState` if that turns out cleaner during plan time. The spec accepts
  either approach.

### Internal state additions

```ts
interface InternalState {
  // ... existing fields

  /** Currently open HTML block kind, or null. */
  htmlBlockKind: 1 | 2 | 3 | 4 | 5 | 6 | 7 | null;
  /** Buffer for an in-progress inline HTML match. Empty when no match held. */
  htmlInlinePending: string;
}
```

## API surface changes

- New types: `MarkdownHtmlInlineNode`, `MarkdownHtmlBlockNode`.
- New guards: `isHtmlInlineNode`, `isHtmlBlockNode`.
- New warning code: `'unterminated_html'`.
- `MarkdownInlineNode` and `MarkdownBlockNode` unions extended.

## Security note (mandatory in README)

`raw` is unsanitized HTML source. Rendering it as HTML directly (e.g.,
`dangerouslySetInnerHTML`) is an XSS risk. Consumers MUST sanitize `raw`
before rendering. Recommended:

- DOMPurify in browser contexts.
- `sanitize-html` in Node contexts.
- For untrusted streaming output, consider rendering HTML nodes as escaped
  text instead.

The README will include a code example showing safe rendering through
DOMPurify, and a prominent callout box.

## Notes for upgraders

- Exhaustive `switch (node.type)` will require new cases for `'html-inline'`
  and `'html-block'`. Compiler will surface this.
- `MarkdownWarning['code']` union grows.
- Existing renderers that did NOT special-case unrecognized node types may
  start emitting raw angle-bracketed text in places they didn't before — this
  IS a visible behavior change. Document prominently.

No backwards-compat shim. 0.4.0 minor bump.

## Validation

Three test layers aligned with the existing
[provider-aligned testing strategy](../plans/2026-05-07-provider-aligned-testing-strategy.md):

1. **Feature unit tests** alongside `src/handlers/html.ts`, plus
   `src/__tests__/chunk-boundary-html.test.ts` covering:
   - All seven block start conditions, each with positive + negative cases.
   - All six inline patterns.
   - Kind-1 multi-line content including blank lines.
   - Kind-6 list of 62 tag names (representative sample).
   - Kind-7 paragraph-interaction rule.
   - Inline HTML inside link text, table cell, list item paragraph.
   - HTML NOT parsed inside code spans / code blocks.
   - HTML block close-on-blank-line interaction with list close.
   - Chunk-boundary cases:
     - Block: `<scrip` ‖ `t>...</scr` ‖ `ipt>` → single kind-1 node.
     - Block: `<!-- com` ‖ `ment -->` → single kind-2 node.
     - Inline: `<spa` ‖ `n>` → single html-inline node when complete.
     - Inline: `<3` → plain text, fast reject.
     - Inline: pending-buffer overflow → flush as text.
   - `unterminated_html` warning paths.
   - Identity preservation across pushes.
   - Use existing `src/__tests__/helpers/chunking.ts` helpers.

2. **Provider-aligned tests** — extend the existing provider test files
   with HTML samples in text deltas. Suggested cases:
   - `<details><summary>...</summary>...</details>` block (kind 6).
   - Inline `<sub>`, `<sup>`, `<kbd>`, `<br>` tags.
   - HTML comments `<!-- author note -->`.
   - Add an HTML sample to `chunking-properties.test.ts` exercising
     `representativePartitions(input)`.

3. **Browser validation phase (follow-up)**:
   - Chrome MCP smoke harness rendering Claude + GPT-4 outputs containing
     `<details>`, `<sub>`, `<sup>`, `<kbd>`, `<br>` through `react-markdown`
     + `rehype-raw` (or DOMPurify pipeline).
   - **XSS regression test** — feed known-malicious payloads
     (`<script>alert(1)</script>`, `<img onerror=...>`) and verify the parser
     captures them faithfully (so a downstream sanitizer can strip them).
   - Integration test verifying React identity preservation across pushes
     during streaming.

## Documentation deltas

When this lands:

- `packages/partial-markdown/README.md`:
  - Remove `HTML inline nodes or HTML block nodes` from `## Limits`.
  - Add a section under "Supported syntax" for HTML, with the
    seven-block-kinds and six-inline-patterns table.
  - Add a prominent **Security** subsection with a sanitization example.
  - Update warning code list with `unterminated_html`.
- `packages/partial-markdown/CHANGELOG.md`: 0.4.0 entry.
- Root `CHANGELOG.md`: not needed (per-package change).

## Open questions

- **Auto-close kind-1 blocks on EOF: warn or silent?** Current spec says warn.
  Confirm during plan review.
- **Inline HTML pending-buffer hold limit?** A pathological input like
  `<a` + 1MB of plain text would hold indefinitely. Cap at, e.g., 4096
  characters and flush as text on overflow with no warning. Confirm during
  plan review.

## References

- [CommonMark §4.6 HTML blocks](https://spec.commonmark.org/0.31.2/#html-blocks)
- [CommonMark §6.6 Raw HTML](https://spec.commonmark.org/0.31.2/#raw-html)
- [DOMPurify](https://github.com/cure53/DOMPurify)
- [`rehype-sanitize`](https://github.com/rehypejs/rehype-sanitize)
