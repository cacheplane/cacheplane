# Math (LaTeX) — Design

**Status:** Draft
**Date:** 2026-05-07
**Package:** `@cacheplane/partial-markdown`
**Target version:** `0.4.0` (batched with link refs + HTML)
**Authors:** Brian Love (with Claude)

## Summary

Add streaming-aware support for inline and display math, recognizing both
dollar (`$..$`, `$$..$$`) and TeX-bracket (`\(..\)`, `\[..\]`) delimiter
families. Math content is captured as opaque text — no LaTeX parsing — and
exposed via two new node types ready for downstream KaTeX or MathJax rendering.

## 0.4.0 Implementation Note

The first implementation follows the parser's existing line-buffered inline
architecture: closed inline math is recognized when its containing line is
committed. Display math is represented as a streaming block node and grows as
content lines are committed. True character-by-character inline math node
creation before a newline remains a future parser-architecture enhancement.

## Motivation

The two largest LLM providers emit math in *different* delimiter conventions:

| Provider | Inline | Display | Notes |
|---|---|---|---|
| OpenAI (GPT-4 / GPT-5) | `\(..\)` | `\[..\]` | Documented compatibility pain point with most Markdown editors. |
| Anthropic (Claude) | `$..$` | `$$..$$` | LaTeX rendering shipped 2024. |
| Google (Gemini) | `$..$` | `$$..$$` | Standard Pandoc-style. |

The de-facto standard for parsing LLM math output is `remark-math`, which
recognizes all four delimiter forms. Our consumers will be doing the same. To
deliver the value users expect from a streaming Markdown parser intended for
LLM output, we need to recognize both families out of the box.

The core challenge is the `$` ambiguity: `It costs $5 and $10` should remain
plain text. Pandoc-style adjacency rules solve this cleanly.

## Goals

- Recognize four delimiter forms by default: `$..$`, `$$..$$`, `\(..\)`, `\[..\]`.
- Per-family disable switch via parser options.
- Pandoc-style adjacency rules on `$` to minimize currency / variable false
  positives.
- Streaming-tolerant: math content streams character-by-character; `text` grows
  in place; status flips `streaming → complete` on close.
- Math in any inline position (paragraph, heading, blockquote, list item, table
  cell) and at block position (display math).
- Stable node identity across `push()` calls.

## Non-goals

- LaTeX parsing. We capture raw expression text only.
- LaTeX validation. Malformed LaTeX is the renderer's problem.
- Math inside code spans / code blocks. Code remains opaque (existing
  precedent — `$x^2$` inside backticks is plain code).
- Mid-stream switching of parser options. Options frozen at parser creation.

## Design

### Two new AST kinds

Add to `AstNodeKind`:

- `'math-inline'` — inline node, member of `MarkdownInlineNode`.
- `'math-display'` — block node, member of `MarkdownBlockNode`.

This mirrors the existing `inline-code` / `code-block` split.

### Public types

```ts
export type MathDelimiter = '$' | '$$' | '\\(\\)' | '\\[\\]';

export interface MarkdownMathInlineNode extends MarkdownNodeBase {
  readonly type: 'math-inline';
  /** Raw expression source between delimiters. Excludes the delimiters themselves. */
  text: string;
  /** Which delimiter family was used. Advisory, for round-tripping. */
  delimiter: '$' | '\\(\\)';
}

export interface MarkdownMathDisplayNode extends MarkdownNodeBase {
  readonly type: 'math-display';
  text: string;
  delimiter: '$$' | '\\[\\]';
}
```

`MarkdownInlineNode` union gains `MarkdownMathInlineNode`.
`MarkdownBlockNode` union gains `MarkdownMathDisplayNode`.

New type guards: `isMathInlineNode`, `isMathDisplayNode`.

### Parser options

`createPartialMarkdownParser` (and its pull-style equivalents) gain an optional
options argument:

```ts
export interface PartialMarkdownParserOptions {
  math?: {
    /** Recognize $..$ and $$..$$. Default: true. */
    dollar?: boolean;
    /** Recognize \(..\) and \[..\]. Default: true. */
    bracket?: boolean;
  };
}

export function createPartialMarkdownParser(
  options?: PartialMarkdownParserOptions,
): PartialMarkdownParser;
```

Pull-style:

```ts
export function create(options?: PartialMarkdownParserOptions): StreamState;
```

Options are persisted in `InternalState.options` (frozen on creation).

### Detection — dollar family

#### `$..$` (inline)

Pandoc-style adjacency rules, with one extension borrowed from KaTeX's
auto-render (rule #2b) to suppress currency:

1. The opener `$` must be preceded by start-of-input, whitespace, or a
   punctuation character — not a digit and not a letter (suppresses `a$b`).
2. The character immediately AFTER the opener `$` must NOT be whitespace.
2b. The character immediately AFTER the opener `$` must NOT be an ASCII
    digit (`0`–`9`). This suppresses currency forms like `$5`, `$1.50`.
3. The character immediately BEFORE the closer `$` must NOT be whitespace.
4. The character immediately AFTER the closer `$` must NOT be a digit.
5. Backslash escape: `\$` is a literal dollar sign and never opens or
   closes math.

```
✓ $x^2$            → math-inline, text='x^2'
✓ Result is $a+b$. → math-inline, text='a+b'
✗ It costs $5      → plain text (rule #2b: opener followed by digit).
✗ $ x $            → plain text (rules #2 and #3: whitespace adjacency).
✗ $5 and $10$      → plain text (every candidate opener is followed by a
                     digit; rule #2b rejects).
✗ \$5              → literal dollar sign (rule #5).
✗ Items: $5, $10   → plain text. Both candidate openers fail rule #2b.
```

> **Note on residual ambiguity:** even with rule #2b, an LLM-emitted
> sentence like `Set $a = 5$ and the cost is $b` could capture an unintended
> span. The fallback machinery (tentative-match buffer flushing on paragraph
> close) and the explicit `dollar: false` opt-out cover the remaining cases.
> Consumers who emit currency-heavy text should disable the dollar family.

> **Implementation note:** "no valid closer with adjacency rules" must
> efficiently fall back to plain text. Strategy: use a tentative-match buffer
> in the inline scanner — like the existing `tablePending` pattern. If the
> match doesn't resolve before paragraph close or before another higher-precedence
> construct opens, flush as plain text.

#### `$$..$$` (display)

- Block-level: a `$$` token at the start of a line opens a display math block.
  Content runs until the next `$$` token on its own line OR within a line. The
  closing `$$` may share a line with the opener (single-line display math).
- No adjacency rules apply to `$$` — fewer false positives because `$$` is
  rare in non-math text.
- Allowed inline at the start of a paragraph if directly followed by content
  on the same line (e.g., `$$x^2 = y$$`). Becomes a single-paragraph block.
- An unterminated `$$` block at `finish()` closes with status `complete` and
  emits warning `unterminated_math`.

### Detection — bracket family

#### `\(..\)` (inline)

- Opener: literal characters `\(`. The backslash must NOT itself be escaped
  (i.e., `\\(` is a literal backslash then `(`, not a math opener).
- Closer: literal `\)`. Same backslash-escape rule.
- No adjacency rules — backslash-bracket is unambiguous.
- Backslash escapes inside the math content are passed through verbatim.

```
✓ \(x^2\)          → math-inline, text='x^2', delimiter='\\(\\)'
✓ See \(\frac{a}{b}\) here → math-inline, text='\\frac{a}{b}'
✗ \\(x\\)          → plain text (\\\\ is escaped backslash; \\( becomes (\)
```

#### `\[..\]` (display)

- Block-level when the opener `\[` is at the start of a line; closes on `\]`
  which may be at end of line or end-of-block.
- Inline if `\[` appears mid-line. Must close before paragraph end.

> **Implementation note:** `\[` and `\(` overlap with markdown reference-link
> bracket constructs. Resolution rule: math openers `\(` and `\[` are LITERAL
> backslash-bracket sequences, never preceded by another `\` and never inside
> code. Reference link openers are bare `[`. No conflict in practice.

### Streaming semantics

Each math node streams via the same pattern as fenced code:

1. **Open** — opener token consumed; node created with `status: 'streaming'`,
   `text: ''`. `'node-created'` event emitted.
2. **Body** — every character (including newlines for display math) appended
   to `text`. `'value-updated'` events with `delta` fields. Identity preserved.
3. **Close** — closer token matched; status flips to `complete`,
   `'node-completed'` emitted.

Chunk boundary cases (must be tested):

| Boundary | Behavior |
|---|---|
| `$x^` ‖ `2$` | One math-inline node, text='x^2'. |
| `$$\sum` ‖ `_i a_i$$` | One math-display node. |
| `\(x` ‖ `^2\)` | One math-inline node. |
| `$` ‖ ` x$` | Adjacency rule fails on second push (whitespace after open) → plain text. |
| `$x` ‖ ` $` | Closer adjacency fails → tentative match flushed as text on paragraph close. |
| `\(unterminat` ‖ `ed` (then finish) | `unterminated_math` warning, node forced to complete. |

### Identity preservation

A math node created on first opener-detection is the SAME object reference for
the lifetime of the document. Only `text` and `status` mutate. `materialize()`
uses a fingerprint of `(text.length, status)` to invalidate snapshots — same
pattern as `code-block`.

### Interaction with existing constructs

| Context | Behavior |
|---|---|
| Inside code span / code block | NOT parsed. Existing opacity wins. |
| Inside link text `[$x^2$](url)` | Math IS parsed — link text is an inline content position. |
| Inside table cell | Math IS parsed. |
| Inside list item paragraph | Math IS parsed. |
| Inside emphasis / strong / strikethrough | Math IS parsed. |
| `$$` opening immediately after a `>` (blockquote) | Display math IS parsed inside blockquotes. |

### Warnings (new code)

```ts
'unterminated_math'    // emitted at finish() if a math node is still streaming
```

`MarkdownWarning['code']` union extended.

### Parse modes

New `ParseMode` values:

- `'math-inline'` — inside `$..$` or `\(..\)`.
- `'math-display'` — inside `$$..$$` or `\[..\]`.

The active delimiter family is tracked on `InternalState.mathOpener: '$' | '$$' | '\\(' | '\\['` so the close-token matcher knows what to look for.

## API surface changes

- New types: `MarkdownMathInlineNode`, `MarkdownMathDisplayNode`,
  `PartialMarkdownParserOptions`.
- New guards: `isMathInlineNode`, `isMathDisplayNode`.
- `createPartialMarkdownParser(options?)` — new optional argument.
- `create(options?)` (pull-style) — new optional argument.
- New warning code: `'unterminated_math'`.
- `MarkdownInlineNode` and `MarkdownBlockNode` unions extended.

## Notes for upgraders

- Exhaustive `switch (node.type)` will require new cases for `'math-inline'`
  and `'math-display'`. Compiler will surface this.
- `MarkdownWarning['code']` union grows.
- `createPartialMarkdownParser()` argument is optional and defaults preserve
  backwards-compatible behavior — no caller changes required for adopters who
  don't use math.
- Math is **on by default**. Consumers who do NOT want math (and who emit text
  with bare `$x$` they expect to render literally) must opt out via
  `createPartialMarkdownParser({ math: { dollar: false, bracket: false } })`.

No backwards-compat shim. 0.4.0 minor bump.

## Validation

Three test layers aligned with the existing
[provider-aligned testing strategy](../plans/2026-05-07-provider-aligned-testing-strategy.md):

1. **Feature unit tests** alongside `src/handlers/math.ts`, plus
   `src/__tests__/chunk-boundary-math.test.ts` covering:
   - All four delimiter forms.
   - Pandoc-plus adjacency rules on `$` (positive + negative cases including
     currency: `$5`, `$1.50`, `Items: $5, $10`).
   - Backslash escape `\$` and `\\(`.
   - Display math single-line and multi-line.
   - Math inside paragraphs, headings, list items, table cells, blockquotes.
   - Math NOT parsed inside code.
   - All chunk-boundary cases listed above.
   - `unterminated_math` warning.
   - Parser-options disable: `dollar: false` skips `$..$` and `$$..$$`;
     `bracket: false` skips `\(..\)` and `\[..\]`.
   - Identity preservation across streaming.
   - Use existing `src/__tests__/helpers/chunking.ts` helpers for
     partition-equivalence.

2. **Provider-aligned tests** — extend the existing provider test files:
   - `provider-anthropic.test.ts`: add cases with `$..$` and `$$..$$` in
     text deltas (Claude's native style).
   - `provider-openai.test.ts`: add cases with `\(..\)` and `\[..\]` in text
     deltas (GPT's native style).
   - `provider-gemini.test.ts`: add cases with `$..$` (Gemini's native
     style).
   - Add a math sample to `chunking-properties.test.ts` exercising
     `representativePartitions(input)`.

3. **Browser validation phase (follow-up)**:
   - Chrome MCP smoke harness rendering live Claude (`$..$`) and GPT-4
     (`\(..\)`) math samples through `react-markdown` + `rehype-katex`.
   - Integration test verifying KaTeX rendering of streamed math without
     flicker / re-render storms.

## Documentation deltas

When this lands:

- `packages/partial-markdown/README.md`:
  - Remove `Math` from `## Limits`.
  - Add a section under "Supported syntax → Inline" / "→ Block-level" for
    math, listing all four delimiter forms.
  - Document parser-options shape and defaults.
  - Update warning code list with `unterminated_math`.
- `packages/partial-markdown/CHANGELOG.md`: 0.4.0 entry.

## Open questions

- **Default-on for `dollar`?** `$5` currency false-positive risk is mitigated
  by adjacency rules but not eliminated. Recommendation: ship default-on
  because the false-positive rate on real LLM math output is dominated by the
  benefit. Confirm during plan review.
- **`math-inline` allowed inside link URL?** Spec says no — URL is opaque.
  Confirm.

## References

- [Pandoc Math syntax](https://pandoc.org/MANUAL.html#math)
- [`remark-math`](https://github.com/remarkjs/remark-math)
- [KaTeX delimiters reference](https://katex.org/docs/autorender.html)
- [OpenAI cookbook issue #2295: bracket delimiter compatibility](https://github.com/openai/openai-cookbook/issues/2295)
