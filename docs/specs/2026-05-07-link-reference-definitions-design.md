# Link Reference Definitions — Design

**Status:** Draft
**Date:** 2026-05-07
**Package:** `@cacheplane/partial-markdown`
**Target version:** `0.4.0` (batched with math + HTML)
**Authors:** Brian Love (with Claude)

## Summary

Add streaming-aware support for CommonMark link reference definitions
(`[label]: url "title"`) and the three reference link forms that consume them:

- **Full:** `[text][label]`
- **Collapsed:** `[label][]`
- **Shortcut:** `[label]`

Definitions and references can arrive in any order across the stream. References
expose unresolved nodes immediately, then mutate to `resolved: true` with `url`
and `title` populated when the matching definition arrives. Identity preserved
end-to-end.

## Motivation

CommonMark §4.7 / §6.3. Today, the parser treats `[text][label]` as plain inline
text — losing structure that downstream renderers expect. LLMs increasingly emit
reference-style links, especially when summarizing source material with a
trailing definition list. Without first-class support, consumers must
post-process the stream, which defeats the whole point of incremental rendering.

The existing **citation** feature (Pandoc footnote-style `[^id]` + `[^id]: ...`)
already implements forward-resolving references with identity preservation —
this spec mirrors that architecture closely.

## Goals

- Recognize all three reference link forms (full, collapsed, shortcut) in any
  inline context (paragraph, heading, blockquote, list item, table cell).
- Recognize single-line link reference definitions per CommonMark §4.7.
  Multi-line titles are deferred because real LLM output overwhelmingly emits
  the compact one-line form.
- Forward resolution: a reference that arrives before its definition is exposed
  in `streaming` status with `resolved: false`; mutates in place to
  `resolved: true` with `url` / `title` when the definition arrives.
- Stable node identity across `push()` calls, just like citations.
- Sidecar `linkDefinitions: Map<string, LinkDefinition>` on the document root
  for consumers who want to enumerate or look up definitions.
- Diagnostics: warnings for unresolved refs, unused defs, duplicate defs.

## Non-goals

- HTML rendering decisions. The parser surfaces structure; consumers render.
- Auto-linking definition labels. Plain `https://...` autolink behavior is
  unchanged.
- Image references (`![alt][label]`) — covered as a follow-up sibling story
  that reuses this infrastructure (out of scope here).
- Recovery of malformed definitions (e.g., missing closing `>` on `<url>`
  form). On malformed input, fall back to plain inline text.

## Design

### New AST kinds

Add to `AstNodeKind` and the `MarkdownNodeType` mirror:

- `'link-reference'` — inline node.
- `'link-definition'` — block-level during parse, but lifted off the document
  tree on `finish()` (analogous to citation definitions). Not exposed in
  `MarkdownBlockNode`. Lives only in the sidecar.

### Public types

```ts
export interface MarkdownLinkReferenceNode extends MarkdownNodeBase {
  readonly type: 'link-reference';
  /** Normalized label (CommonMark §4.7: case-folded, whitespace-collapsed). */
  refId: string;
  /** Original label as it appeared in source, for round-tripping. */
  label: string;
  /** Link text children. For shortcut form, equal to a single text node of `label`. */
  children: MarkdownInlineNode[];
  /** Reference form, useful for renderers that want to round-trip. */
  form: 'full' | 'collapsed' | 'shortcut';
  /** false until matching def arrives. Mutates in place. */
  resolved: boolean;
  /** Populated when resolved. Empty string before. */
  url: string;
  /** Populated when resolved. Empty string before. */
  title: string;
}

export interface LinkDefinition {
  /** Normalized label. */
  id: string;
  /** Original label as authored. */
  label: string;
  url: string;
  title: string;
  status: StreamStatus;
}

export interface MarkdownDocumentNode extends MarkdownNodeBase {
  readonly type: 'document';
  children: MarkdownBlockNode[];
  citations: Map<string, CitationDefinition>;
  /** New in 0.4.0. Keyed by normalized label. Insertion-ordered. */
  linkDefinitions: Map<string, LinkDefinition>;
}
```

`MarkdownInlineNode` union gains `MarkdownLinkReferenceNode`.

New type guard: `isLinkReferenceNode`.

### Internal state additions

```ts
interface InternalState {
  // ... existing fields

  /** Map of normalized label → AstNode ids of unresolved references. */
  linkRefIds: Map<string, number[]>;
  /** Map of normalized label → definition AstNode id. */
  linkDefs: Map<string, {
    id: string;
    label: string;
    url: string;
    title: string;
    status: StreamStatus;
  }>;
}
```

### Label normalization

Per CommonMark §4.7:
1. Strip leading/trailing whitespace.
2. Collapse internal whitespace runs (spaces, tabs, line endings) to a single
   space.
3. Lowercase using Unicode case folding (`String.prototype.toLowerCase()`
   suffices for the LLM-output character set we target — true Unicode case
   fold is out of scope).

```ts
function normalizeLinkLabel(raw: string): string {
  return raw.trim().replace(/[\s ]+/g, ' ').toLowerCase();
}
```

### Detection — definitions

A line beginning a definition matches:

```
^ {0,3}\[ <label> \]: \s* <destination> ( \s+ <title> )? \s* $
```

Where:
- `<label>`: 1–999 characters, may not contain unescaped `]`.
- `<destination>`: either `<url>` (angle-bracketed, may contain spaces) or a
  bare URL (no spaces, no control chars).
- `<title>`: `"..."`, `'...'`, or `(...)` on the same line as the destination.
  CommonMark allows multi-line titles; this implementation deliberately defers
  that lower-frequency case.

A definition can only appear at the start of a line and must NOT be inside an
open paragraph (CommonMark requires it to be a standalone block-level
construct). A definition that begins inside an open paragraph closes that
paragraph first.

Reserved `ParseMode`: `'link-def-title'` for a future multi-line
title-continuation case.

### Detection — references

Inline scanner (in `inline` mode), after finding `[`:

1. Scan to matching `]` honoring inline-code-span and escape rules.
2. Look ahead at the next character(s):
   - `[label]` immediately followed by `[label2]` → **full** reference,
     `text=label`, `refId=normalize(label2)`.
   - `[text][]` → **collapsed** reference, `text=text`, `refId=normalize(text)`.
   - `[label]` not followed by `[` or `(` → **shortcut** reference,
     `text=label`, `refId=normalize(label)`. Suppressed if the next non-space
     token would have made it a regular inline link `[text](url)`.

If `[text](url)` matches first, that path wins (existing behavior, unchanged).

### Forward resolution

When a definition with normalized label `L` is finalized:
1. Look up `linkRefIds.get(L)` — list of unresolved reference node ids.
2. For each, mutate in place: set `url`, `title`, `resolved = true`. Status
   transitions to `complete` if not already.
3. Clear `linkRefIds.get(L)` (or delete the entry).

When a reference with normalized label `L` arrives and `linkDefs.has(L)`:
- Resolve immediately (`resolved: true`, `status: complete`).
- Otherwise, append node id to `linkRefIds.get(L)` (creating list if absent),
  expose with `resolved: false`, `status: streaming`.

Citation definitions and link definitions live in **separate** sidecars and
namespaces — no risk of collision (citations use `[^id]`, link defs use
`[label]:`).

### Streaming semantics

- Reference cut mid-label: `[ti` chunk break `tle][lab]` — entire `[...]` is
  parsed atomically when the closing `]` of the second pair arrives. Until
  then, accumulate as plain text in the inline buffer; promote to
  `link-reference` when the structure resolves. (Same pattern as existing
  emphasis flanking and citation refs.)
- Definition cut mid-URL: `[lab]: https://exam` chunk break `ple.com` — open a
  `link-definition` AST node in `streaming` status, accumulate destination
  characters, finalize on the destination terminator.
- Definition with title spanning lines: enter `link-def-title` mode, accumulate
  until matching close delimiter, then finalize.
- Unterminated definition at `finish()`: fall back to plain text (definition
  was never valid). No warning emitted (would be too noisy on truncated
  input).

### Identity preservation

- A `MarkdownLinkReferenceNode` created in unresolved state is the SAME object
  reference after resolution. Only mutable fields change: `resolved`, `url`,
  `title`, `status`.
- `LinkDefinition` entries in `linkDefinitions` Map are stable across pushes
  (Map insertion order, never re-keyed).
- `materialize()` uses fingerprinting to invalidate the document snapshot when
  any link def is added or any reference resolves. Reference snapshots are
  re-materialized when their `resolved` flag flips.

### Warnings (new codes)

```ts
'unresolved_link_ref'      // ref present, def never arrived (emitted at finish)
'unused_link_def'          // def present, no refs ever pointed at it (at finish)
'duplicate_link_def'       // second def with same normalized label (first wins)
```

`MarkdownWarning['code']` union extended.

### Edge cases the spec resolves

| Case | Behavior |
|---|---|
| `[Foo]` resolved by `[foo]: ...` | Resolves (case-insensitive normalization). |
| `[a   b]` resolved by `[a b]: ...` | Resolves (whitespace-collapsed). |
| Definition inside a list item | Treated as a regular paragraph — definitions are NOT recognized inside list items in this version (CommonMark allows it but adds significant complexity). Plain paragraph fallback. Document this in the README as a limit. |
| Reference inside table cell | Resolves normally. |
| Reference inside code span | Not parsed (existing precedent — code spans are opaque). |
| Two defs with same label | First wins; `duplicate_link_def` warning emitted on second. |
| Image reference `![alt][label]` | NOT parsed in this version. The `![alt][label]` sequence does not match the existing inline image grammar (`![alt](url)`) and falls through to plain text. No warning. Image references are tracked as a follow-up sibling story. |

> **Note:** The "list item definition" carve-out is a known divergence from
> strict CommonMark. The README must call this out under `## Limits`.

## API surface changes

- New types: `MarkdownLinkReferenceNode`, `LinkDefinition`.
- New guard: `isLinkReferenceNode`.
- New warning codes (added to `MarkdownWarning['code']`).
- `MarkdownDocumentNode.linkDefinitions` is a **required** field (breaking).

## Notes for upgraders

- `MarkdownDocumentNode` now requires `linkDefinitions: Map<string, LinkDefinition>`.
  Existing manual constructions of the document node will TypeScript-error
  until the field is initialized. Use `new Map()` for an empty doc.
- Any exhaustive `switch (node.type)` on `MarkdownInlineNode` will report a
  missing `'link-reference'` case. Compiler will surface this.
- `MarkdownWarning['code']` union grows; same exhaustiveness story.

No backwards-compat shim is provided. This is a 0.4.0 minor bump and explicit
breakage is acceptable per project policy.

## Validation

This spec ships with **three test layers** in the implementation plan, aligned
with the existing
[provider-aligned testing strategy](../plans/2026-05-07-provider-aligned-testing-strategy.md):

1. **Feature unit tests** alongside `src/handlers/link-references.ts`, plus
   `src/__tests__/chunk-boundary-link-refs.test.ts` covering:
   - All three reference forms.
   - Forward resolution across chunk boundaries.
   - Single-line definitions with optional titles.
   - Label normalization edge cases.
   - All three warning codes.
   - Identity preservation across resolution.
   - Use the existing `src/__tests__/helpers/chunking.ts` helpers
     (`chunksAt`, `oneCharChunks`, `representativePartitions`) for
     partition-equivalence assertions.

2. **Provider-aligned tests** — extend the existing
   `provider-anthropic.test.ts`, `provider-openai.test.ts`,
   `provider-gemini.test.ts` with cases that include reference-style links in
   text deltas. Verify the parser's behavior is identical regardless of which
   provider's event shape feeds it. Add a case to
   `chunking-properties.test.ts` exercising a sample with a reference + def
   across all `representativePartitions(input)`.

3. **Browser validation phase (separate follow-up plan)** after
   implementation lands:
   - Chrome MCP smoke harness rendering live LLM samples (Claude + GPT-4
     output containing reference links) through `react-markdown`.
   - Integration test in a small downstream consumer app verifying React
     `memo` does NOT re-render link nodes that haven't changed across
     streaming pushes.

## Documentation deltas

When this lands, update:

- `packages/partial-markdown/README.md`:
  - Move "Link reference definitions" out of `## Limits`.
  - Add a new section under "Supported syntax → Inline" explaining the three
    reference forms and the `linkDefinitions` sidecar.
  - Update the warning code list with three new codes.
  - Document the list-item-definition carve-out under `## Limits`.
- `packages/partial-markdown/CHANGELOG.md`: add 0.4.0 entry.
- Root `CHANGELOG.md`: not needed for this feature alone (per-package change).

## Open questions

- **Image references** (`![alt][label]`) — defer to follow-up or include? Spec
  currently defers. Confirm during plan review.
- **Strict CommonMark Unicode case folding** vs. JS `toLowerCase()` — defer to
  the LLM-output character set; revisit if a real consumer needs CJK label
  matching.
- **Multi-line definition titles** — deferred until a real provider sample or
  consumer integration requires the extra streaming state.

## References

- [CommonMark §4.7 Link reference definitions](https://spec.commonmark.org/0.31.2/#link-reference-definitions)
- [CommonMark §6.3 Links](https://spec.commonmark.org/0.31.2/#links)
- Existing citations precedent: `packages/partial-markdown/src/handlers/`
  (search `citation`).
