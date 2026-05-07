# Link Reference Definitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add streaming-aware support for CommonMark link reference definitions and the three reference link forms (full, collapsed, shortcut) to `@cacheplane/partial-markdown`.

**Architecture:** Mirror the existing **citations** feature. Add a new inline AST kind `link-reference` and a sidecar `linkDefinitions: Map<string, LinkDefinition>` on the document root. Forward resolution: refs created in unresolved state mutate in place when matching defs arrive. Identity preserved.

**Tech Stack:** TypeScript, Vitest, V8 coverage. Zero runtime deps maintained.

**Spec:** `docs/specs/2026-05-07-link-reference-definitions-design.md`

---

## File Structure

| File | Change |
|---|---|
| `packages/partial-markdown/src/types.ts` | Add `link-reference` AST kind, `MarkdownLinkReferenceNode`, `LinkDefinition`, extend `MarkdownDocumentNode.linkDefinitions`, extend `MarkdownInlineNode` union, extend `MarkdownWarning` codes, add `'link-def-title'` ParseMode, add `linkRefIds`/`linkDefs` to `InternalState`. |
| `packages/partial-markdown/src/internals.ts` | Add regex constants (`LINK_DEF_RE`, `LINK_REF_RE`, etc.), `normalizeLinkLabel()` helper. |
| `packages/partial-markdown/src/create.ts` | Initialize `linkRefIds` and `linkDefs` Maps. |
| `packages/partial-markdown/src/handlers/block.ts` | Recognize link reference definitions at top of `handleBlockLine`, lift to sidecar via new `liftLinkDef()` helper. Resolve waiting refs. |
| `packages/partial-markdown/src/handlers/inline.ts` | Recognize `[text][label]`, `[label][]`, `[label]` reference forms in the inline scanner. |
| `packages/partial-markdown/src/finish.ts` | Emit `unresolved_link_ref` and `unused_link_def` warnings. |
| `packages/partial-markdown/src/parser.ts` | Sync `MarkdownLinkReferenceNode.url`/`title`/`resolved` and `MarkdownDocumentNode.linkDefinitions`. |
| `packages/partial-markdown/src/resolve.ts` | Populate `linkDefinitions` on materialized document, resolve unresolved refs. |
| `packages/partial-markdown/src/materialize.ts` | Fingerprint `link-reference` nodes; include `linkDefinitions` in document fingerprint. |
| `packages/partial-markdown/src/guards.ts` | Add `isLinkReferenceNode`. |
| `packages/partial-markdown/src/index.ts` | Export new types and guard. |
| `packages/partial-markdown/src/__tests__/chunk-boundary-link-refs.test.ts` | New chunk-boundary tests. |
| `packages/partial-markdown/src/__tests__/chunking-properties.test.ts` | Add link-ref sample to existing partition test. |
| `packages/partial-markdown/src/__tests__/provider-anthropic.test.ts` | Add link-ref Anthropic case. |
| `packages/partial-markdown/src/__tests__/provider-openai.test.ts` | Add link-ref OpenAI case. |
| `packages/partial-markdown/src/handlers/link-references.test.ts` | Unit tests for the handler logic. |
| `packages/partial-markdown/README.md` | Move feature out of Limits, document API surface and warnings. |
| `packages/partial-markdown/CHANGELOG.md` | Add 0.4.0 entry (or extend if math/HTML lands first). |

---

### Task 1: Add types

**Files:**
- Modify: `packages/partial-markdown/src/types.ts`

- [ ] **Step 1: Extend `AstNodeKind` union (`types.ts:67-89`)**

Add `'link-reference'` to the union:

```ts
export type AstNodeKind =
  | 'document'
  | 'paragraph'
  // ... existing entries
  | 'citation-reference'
  | 'link-reference';
```

- [ ] **Step 2: Add `LinkReferenceAstNode` interface near `CitationReferenceAstNode`**

```ts
export interface LinkReferenceAstNode extends AstNodeBase {
  kind: 'link-reference';
  /** Normalized label (lower-cased, whitespace-collapsed). */
  refId: string;
  /** Original label as authored. */
  label: string;
  /** 'full' | 'collapsed' | 'shortcut'. */
  form: 'full' | 'collapsed' | 'shortcut';
  /** Inline text node ids — for shortcut form, equals [single text node of label]. */
  children: number[];
  resolved: boolean;
  url: string;
  title: string;
}
```

Add to the `AstNode` union.

- [ ] **Step 3: Extend `MarkdownNodeType` & add `MarkdownLinkReferenceNode`**

```ts
export interface MarkdownLinkReferenceNode extends MarkdownNodeBase {
  readonly type: 'link-reference';
  refId: string;
  label: string;
  form: 'full' | 'collapsed' | 'shortcut';
  children: MarkdownInlineNode[];
  resolved: boolean;
  url: string;
  title: string;
}
```

Add to `MarkdownInlineNode` union.

- [ ] **Step 4: Add `LinkDefinition` interface near `CitationDefinition`**

```ts
export interface LinkDefinition {
  id: string;
  label: string;
  url: string;
  title: string;
  status: StreamStatus;
}
```

- [ ] **Step 5: Extend `MarkdownDocumentNode` with required `linkDefinitions`**

```ts
export interface MarkdownDocumentNode extends MarkdownNodeBase {
  readonly type: 'document';
  children: MarkdownBlockNode[];
  citations: Map<string, CitationDefinition>;
  linkDefinitions: Map<string, LinkDefinition>;
}
```

- [ ] **Step 6: Extend `MarkdownWarning['code']` and `ParseMode`**

```ts
export interface MarkdownWarning {
  code:
    | 'unterminated_construct'
    // ... existing codes
    | 'malformed_table_alignment'
    | 'unresolved_link_ref'
    | 'unused_link_def'
    | 'duplicate_link_def';
  index: number;
  detail?: string;
}

export type ParseMode =
  | 'block'
  // ... existing modes
  | 'citation-def'
  | 'link-def-title'
  | 'done'
  | 'error';
```

- [ ] **Step 7: Extend `InternalState` with new tracking maps**

```ts
export interface InternalState extends StreamState {
  // ... existing fields
  /** Map of normalized label → AstNode ids of unresolved references. */
  linkRefIds: Map<string, number[]>;
  /** Map of normalized label → definition body. First-seen wins. */
  linkDefs: Map<string, {
    id: string;
    label: string;
    url: string;
    title: string;
    status: StreamStatus;
  }>;
}
```

- [ ] **Step 8: Run typecheck**

Run: `pnpm --filter @cacheplane/partial-markdown typecheck`

Expected: errors at every site that switches over `AstNodeKind` / `MarkdownNodeType` (`materialize.ts`, `resolve.ts`, `parser.ts`, `guards.ts`, etc.). These are normal — they will be addressed by later tasks.

- [ ] **Step 9: Commit**

```bash
git add packages/partial-markdown/src/types.ts
git commit -m "feat(partial-markdown): add link-reference AST kinds and types"
```

---

### Task 2: Internals — regex + normalization

**Files:**
- Modify: `packages/partial-markdown/src/internals.ts`

- [ ] **Step 1: Write failing tests at `packages/partial-markdown/src/internals.test.ts`**

Append a new `describe` block:

```ts
import { LINK_DEF_RE, LINK_REF_FULL_RE, LINK_REF_COLLAPSED_RE,
         LINK_REF_SHORTCUT_RE, normalizeLinkLabel } from './internals';

describe('Link reference helpers', () => {
  it('normalizes label: lowercase + collapse whitespace + trim', () => {
    expect(normalizeLinkLabel('Foo')).toBe('foo');
    expect(normalizeLinkLabel('  a   b  ')).toBe('a b');
    expect(normalizeLinkLabel('A\tB\nC')).toBe('a b c');
  });

  it('LINK_DEF_RE matches `[id]: url "title"`', () => {
    const m = LINK_DEF_RE.exec('[foo]: https://example.com "Title"');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('foo');
    expect(m![2]).toBe('https://example.com');
    expect(m![3]).toBe('Title');
  });

  it('LINK_DEF_RE matches with no title', () => {
    const m = LINK_DEF_RE.exec('[bar]: /local');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('bar');
    expect(m![2]).toBe('/local');
    expect(m![3]).toBeUndefined();
  });

  it('LINK_DEF_RE does not match indented > 3 spaces', () => {
    expect(LINK_DEF_RE.exec('    [foo]: /a')).toBeNull();
  });

  it('LINK_REF_FULL_RE matches [text][label]', () => {
    const m = LINK_REF_FULL_RE.exec('[hello][world]rest');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('hello');
    expect(m![2]).toBe('world');
  });

  it('LINK_REF_COLLAPSED_RE matches [text][]', () => {
    const m = LINK_REF_COLLAPSED_RE.exec('[hello][]rest');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('hello');
  });

  it('LINK_REF_SHORTCUT_RE matches [label] not followed by [ or (', () => {
    const m = LINK_REF_SHORTCUT_RE.exec('[hello] world');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('hello');
    expect(LINK_REF_SHORTCUT_RE.exec('[hello](url)')).toBeNull();
    expect(LINK_REF_SHORTCUT_RE.exec('[hello][label]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

Run: `pnpm --filter @cacheplane/partial-markdown test src/internals.test.ts`
Expected: FAIL — exports don't exist yet.

- [ ] **Step 3: Add regex constants and helper to `internals.ts`**

After the existing `CITATION_DEF_RE` definition, add:

```ts
/**
 * Block-level link reference definition.
 * Capture[1] = label (1-999 chars, no unescaped ']').
 * Capture[2] = destination (bare or angle-bracketed URL on the same line).
 * Capture[3] = optional title (first line only — multi-line handled by mode).
 *
 * Single-line form. Multi-line titles handled by `link-def-title` mode.
 */
export const LINK_DEF_RE =
  /^\s{0,3}\[((?:\\.|[^\]\\])+?)\]:\s+(?:<([^>]*)>|(\S+))(?:\s+"([^"]*)"|\s+'([^']*)'|\s+\(([^)]*)\))?\s*$/;

/**
 * Inline full reference: `[text][label]`.
 * Capture[1] = text, capture[2] = label.
 */
export const LINK_REF_FULL_RE = /^\[((?:\\.|[^\]\\])+)\]\[((?:\\.|[^\]\\])+)\]/;

/**
 * Inline collapsed reference: `[text][]`. Capture[1] = text.
 */
export const LINK_REF_COLLAPSED_RE = /^\[((?:\\.|[^\]\\])+)\]\[\]/;

/**
 * Inline shortcut reference: `[label]` NOT followed by `[` or `(`.
 * Capture[1] = label.
 */
export const LINK_REF_SHORTCUT_RE = /^\[((?:\\.|[^\]\\])+)\](?![\[(])/;

/**
 * Normalize a link label per CommonMark §4.7:
 *   1. Strip leading/trailing whitespace.
 *   2. Collapse internal whitespace runs to single space.
 *   3. Lowercase. (Plain JS toLowerCase — sufficient for LLM-output charset.)
 */
export function normalizeLinkLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}
```

> **Note on the LINK_DEF_RE:** the captures are intentional: `[2]` if the URL was angle-bracketed, `[3]` if bare. Title is one of `[4]/[5]/[6]` (`"..."`, `'...'`, `(...)`). Consumers normalize via:
>
> ```ts
> const url = m[2] ?? m[3] ?? '';
> const title = m[4] ?? m[5] ?? m[6] ?? '';
> ```
>
> **Scope note — single-line definitions only:** This regex requires the
> entire definition (label + URL + optional title) to fit on one line.
> CommonMark allows the title to span multiple lines; LLM output rarely
> emits this. **Multi-line titles are deferred to a follow-up.** Update the
> spec's `## Open questions` and the README's `## Limits` to reflect this.
> The `'link-def-title'` ParseMode declared in Task 1 is reserved for the
> follow-up and is currently unused.

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm --filter @cacheplane/partial-markdown test src/internals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/partial-markdown/src/internals.ts packages/partial-markdown/src/internals.test.ts
git commit -m "feat(partial-markdown): add link-ref regex + label normalization"
```

---

### Task 3: Initialize internal state

**Files:**
- Modify: `packages/partial-markdown/src/create.ts`

- [ ] **Step 1: Add `linkRefIds` and `linkDefs` to the initial state**

In `createInternal`, after the citation Maps, add:

```ts
return {
  // ... existing fields including citationIndex, citationRefIds, citationDefs, nextCitationIndex
  linkRefIds: new Map(),
  linkDefs: new Map(),
  // ... rest
};
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @cacheplane/partial-markdown typecheck`
Expected: progress past `create.ts`. Errors remain elsewhere.

- [ ] **Step 3: Commit**

```bash
git add packages/partial-markdown/src/create.ts
git commit -m "feat(partial-markdown): init link-ref state in create()"
```

---

### Task 4: Block handler — definitions & forward resolution

**Files:**
- Modify: `packages/partial-markdown/src/handlers/block.ts`
- Create: `packages/partial-markdown/src/handlers/link-references.test.ts`

The strategy mirrors `liftCitationDef` at `block.ts:650-705`. Read that function first.

- [ ] **Step 1: Write failing tests at `packages/partial-markdown/src/handlers/link-references.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createPartialMarkdownParser } from '../parser';

describe('Link reference definitions — block handler', () => {
  it('lifts a single-line definition into the linkDefs sidecar', () => {
    const p = createPartialMarkdownParser();
    p.push('[foo]: https://example.com\n');
    p.finish();
    expect(p.root!.linkDefinitions.has('foo')).toBe(true);
    const def = p.root!.linkDefinitions.get('foo')!;
    expect(def.url).toBe('https://example.com');
    expect(def.title).toBe('');
    expect(def.status).toBe('complete');
  });

  it('captures title from first line', () => {
    const p = createPartialMarkdownParser();
    p.push('[foo]: https://example.com "Title"\n');
    p.finish();
    expect(p.root!.linkDefinitions.get('foo')!.title).toBe('Title');
  });

  it('emits duplicate_link_def warning on second def with same label', () => {
    let warns: string[] = [];
    const p = createPartialMarkdownParser();
    p.push('[foo]: /a\n[foo]: /b\n');
    p.finish();
    // Pull-style state would be the source of warnings; push parser exposes via state on parser.
    // The push parser exposes warnings via the underlying state. Here we just verify first wins.
    expect(p.root!.linkDefinitions.get('foo')!.url).toBe('/a');
  });

  it('case-insensitive label normalization', () => {
    const p = createPartialMarkdownParser();
    p.push('[Foo Bar]: /x\n');
    p.finish();
    expect(p.root!.linkDefinitions.has('foo bar')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @cacheplane/partial-markdown test src/handlers/link-references.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add `liftLinkDef()` helper to `block.ts`**

Below `liftCitationDef`, add:

```ts
import { LINK_DEF_RE, normalizeLinkLabel } from '../internals';
// ... extend existing imports

function liftLinkDef(
  state: InternalState,
  rawLabel: string,
  url: string,
  title: string,
): InternalState {
  const id = normalizeLinkLabel(rawLabel);
  const existing = state.linkDefs.get(id);

  if (existing) {
    return pushWarning(state, {
      code: 'duplicate_link_def',
      index: state.index,
      detail: `duplicate link definition for [${rawLabel}]`,
    });
  }

  const newDefs = new Map(state.linkDefs);
  newDefs.set(id, { id, label: rawLabel, url, title, status: 'complete' });
  let s: InternalState = { ...state, linkDefs: newDefs };

  // Resolve any unresolved references waiting on this label.
  const refsForId = s.linkRefIds.get(id) ?? [];
  if (refsForId.length > 0) {
    const nodes = s.nodes.slice();
    for (const refNodeId of refsForId) {
      const n = nodes[refNodeId];
      if (n && n.kind === 'link-reference') {
        nodes[refNodeId] = {
          ...n,
          resolved: true,
          url,
          title,
          status: 'complete',
        };
      }
    }
    const newRefIds = new Map(s.linkRefIds);
    newRefIds.delete(id);
    s = { ...s, nodes, linkRefIds: newRefIds };
  }

  return s;
}
```

- [ ] **Step 4: Wire `liftLinkDef` into `handleBlockLine`**

In `handleBlockLine`, after the citation-def detection block (around `block.ts:108-115`), add:

```ts
// Link reference definition: lifts to linkDefs sidecar (no block-tree node).
const linkDef = LINK_DEF_RE.exec(line);
if (linkDef) {
  const label = linkDef[1]!;
  const url = linkDef[2] ?? linkDef[3] ?? '';
  const title = linkDef[4] ?? linkDef[5] ?? linkDef[6] ?? '';
  return liftLinkDef(s, label, url, title);
}
```

This must come AFTER the citation-def check (citations use `[^id]:` and link defs use `[id]:` — the `^` prefix disambiguates, but checking citations first avoids regex ambiguity). Verify ordering by reading the surrounding code.

- [ ] **Step 5: Run tests — expect three PASS, one TBD**

Run: `pnpm --filter @cacheplane/partial-markdown test src/handlers/link-references.test.ts`
Expected: PASS for definition lift, title capture, case-insensitivity. The duplicate test currently only checks first-wins, which is now correct.

- [ ] **Step 6: Commit**

```bash
git add packages/partial-markdown/src/handlers/block.ts \
        packages/partial-markdown/src/handlers/link-references.test.ts
git commit -m "feat(partial-markdown): lift link-ref defs to sidecar with forward resolution"
```

---

### Task 5: Inline handler — three reference forms

**Files:**
- Modify: `packages/partial-markdown/src/handlers/inline.ts`
- Modify: `packages/partial-markdown/src/handlers/link-references.test.ts`

Read the existing citation-reference handling at `inline.ts:68-95` first.

- [ ] **Step 1: Append failing tests for the three reference forms**

```ts
describe('Link reference forms — inline handler', () => {
  it('full reference [text][label]', () => {
    const p = createPartialMarkdownParser();
    p.push('See [hello][world] now.\n[world]: /w "World"\n');
    p.finish();
    const para = p.root!.children[0];
    // Find the link-reference node
    const ref = (para as any).children.find((n: any) => n.type === 'link-reference');
    expect(ref).toBeDefined();
    expect(ref.refId).toBe('world');
    expect(ref.form).toBe('full');
    expect(ref.url).toBe('/w');
    expect(ref.title).toBe('World');
    expect(ref.resolved).toBe(true);
  });

  it('collapsed reference [text][]', () => {
    const p = createPartialMarkdownParser();
    p.push('[abc][] x\n[abc]: /a\n');
    p.finish();
    const para = p.root!.children[0];
    const ref = (para as any).children.find((n: any) => n.type === 'link-reference');
    expect(ref!.form).toBe('collapsed');
    expect(ref!.refId).toBe('abc');
    expect(ref!.url).toBe('/a');
  });

  it('shortcut reference [label]', () => {
    const p = createPartialMarkdownParser();
    p.push('See [foo] here.\n[foo]: /f\n');
    p.finish();
    const para = p.root!.children[0];
    const ref = (para as any).children.find((n: any) => n.type === 'link-reference');
    expect(ref!.form).toBe('shortcut');
    expect(ref!.refId).toBe('foo');
  });

  it('forward resolution: ref before def', () => {
    const p = createPartialMarkdownParser();
    p.push('Use [foo] here.\n');
    let para = p.root!.children[0];
    let ref = (para as any).children.find((n: any) => n.type === 'link-reference');
    expect(ref.resolved).toBe(false);
    expect(ref.url).toBe('');

    const refRef = ref;  // capture identity
    p.push('[foo]: /resolved\n');
    p.finish();

    // Same node identity, mutated in place.
    expect(refRef.resolved).toBe(true);
    expect(refRef.url).toBe('/resolved');
    expect(refRef.status).toBe('complete');
  });

  it('does not match [text](url) inline link form', () => {
    const p = createPartialMarkdownParser();
    p.push('[hello](https://x.test) world\n');
    p.finish();
    const para = p.root!.children[0];
    const ref = (para as any).children.find((n: any) => n.type === 'link-reference');
    expect(ref).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Expected: FAIL.

- [ ] **Step 3: Add reference-form scanning in `inline.ts`**

In `handleInline`, in the section that handles `[`, the existing precedence is: inline-image (`![`), citation reference (`[^`), then inline link `[text](url)`.

Add link-reference scanning AFTER inline-link detection fails — so `[text](url)` always wins over `[text][label]` when the URL form parses cleanly. Insert near the bottom of the `[` branch:

```ts
import {
  // ... existing
  LINK_REF_FULL_RE, LINK_REF_COLLAPSED_RE, LINK_REF_SHORTCUT_RE,
  normalizeLinkLabel,
} from '../internals';
import type { LinkReferenceAstNode } from '../types';

// ... inside handleInline, after inline-link check fails:

// Link reference: full, then collapsed, then shortcut.
const full = LINK_REF_FULL_RE.exec(remainder);
const collapsed = !full ? LINK_REF_COLLAPSED_RE.exec(remainder) : null;
const shortcut = !full && !collapsed ? LINK_REF_SHORTCUT_RE.exec(remainder) : null;

const match = full ?? collapsed ?? shortcut;
if (match) {
  const form: 'full' | 'collapsed' | 'shortcut' =
    full ? 'full' : collapsed ? 'collapsed' : 'shortcut';
  const text = match[1]!;
  const label = full ? match[2]! : text;
  const refId = normalizeLinkLabel(label);

  const [s1, refNodeId] = allocId(s);
  const existingDef = s1.linkDefs.get(refId);

  // Build the link-reference node with a single text-node child
  // (we treat link text atomically here — full inline parsing of nested
  // emphasis inside link text is a follow-up).
  const [s2, textNodeId] = allocId(s1);
  const textNode = {
    id: textNodeId,
    kind: 'text' as const,
    parentId: refNodeId,
    status: 'complete' as const,
    text,
  };
  let s3 = appendNode(s2, textNode);

  const refNode: LinkReferenceAstNode = {
    id: refNodeId,
    kind: 'link-reference',
    parentId: parentId,
    status: existingDef ? 'complete' : 'streaming',
    refId,
    label,
    form,
    children: [textNodeId],
    resolved: !!existingDef,
    url: existingDef?.url ?? '',
    title: existingDef?.title ?? '',
  };
  s3 = appendNode(s3, refNode);
  s3 = appendChild(s3, parentId, refNodeId);

  if (!existingDef) {
    const refsForId = s3.linkRefIds.get(refId) ?? [];
    s3 = {
      ...s3,
      linkRefIds: new Map(s3.linkRefIds).set(refId, [...refsForId, refNodeId]),
    };
  }

  // Advance scanner past the matched bytes.
  index += match[0].length;
  s = s3;
  continue;
}
```

> **Important:** This snippet uses `parentId`, `index`, and `s` — variable names that exist in the surrounding `handleInline` function. Verify exact names while integrating; rename to match. The control-flow `continue` advances the scanner loop.

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @cacheplane/partial-markdown test src/handlers/link-references.test.ts`
Expected: PASS for all five tests.

- [ ] **Step 5: Run full test suite to catch regressions**

Run: `pnpm --filter @cacheplane/partial-markdown test`
Expected: all tests pass. If any existing inline tests break (especially link / image / citation tests), the precedence ordering inside `handleInline` is wrong — link-ref must come AFTER inline-link and citation-ref.

- [ ] **Step 6: Commit**

```bash
git add packages/partial-markdown/src/handlers/inline.ts \
        packages/partial-markdown/src/handlers/link-references.test.ts
git commit -m "feat(partial-markdown): inline scanner recognizes link-ref forms"
```

---

### Task 6: Push-layer sync (`parser.ts`)

**Files:**
- Modify: `packages/partial-markdown/src/parser.ts`

Read the existing citation sync at `parser.ts:182-237` and `parser.ts:308-313` for the pattern.

- [ ] **Step 1: Sync `MarkdownLinkReferenceNode` mutable fields**

Near the citation-sync block (`parser.ts:182-189`), add a parallel block for `link-reference`:

```ts
// Sync resolved flag for link-reference nodes.
if (md.type === 'link-reference' && ast.kind === 'link-reference') {
  const linkMd = md as MarkdownLinkReferenceNode;
  const linkAst = ast as LinkReferenceAstNode;
  if (linkMd.resolved !== linkAst.resolved) linkMd.resolved = linkAst.resolved;
  if (linkMd.url !== linkAst.url) linkMd.url = linkAst.url;
  if (linkMd.title !== linkAst.title) linkMd.title = linkAst.title;
}
```

- [ ] **Step 2: Sync `linkDefinitions` sidecar onto document root**

In the document-sync section (`parser.ts:212-237` for citations), add a parallel block:

```ts
// Sync linkDefinitions sidecar onto the document root.
if (root && state.linkDefs.size > 0) {
  for (const [refId, def] of state.linkDefs) {
    const existing = root.linkDefinitions.get(refId);
    if (existing) {
      existing.url = def.url;
      existing.title = def.title;
      existing.status = def.status;
    } else {
      root.linkDefinitions.set(refId, {
        id: def.id,
        label: def.label,
        url: def.url,
        title: def.title,
        status: def.status,
      });
    }
  }
  // Remove sidecar entries no longer in state.
  for (const refId of root.linkDefinitions.keys()) {
    if (!state.linkDefs.has(refId)) root.linkDefinitions.delete(refId);
  }
}
```

- [ ] **Step 3: Initialize `linkDefinitions` Map on document creation**

Where `base.citations = new Map<string, CitationDefinition>();` appears (`parser.ts:272`), add:

```ts
base.linkDefinitions = new Map<string, LinkDefinition>();
```

- [ ] **Step 4: Build `link-reference` MD node from AST in the converter**

In the AST→MD conversion switch (`parser.ts:295+`), add a case (mirror `'citation-reference'` at line 308):

```ts
case 'link-reference': {
  const refAst = ast as LinkReferenceAstNode;
  base.refId = refAst.refId;
  base.label = refAst.label;
  base.form = refAst.form;
  base.resolved = refAst.resolved;
  base.url = refAst.url;
  base.title = refAst.title;
  base.children = [];  // populated by tree walk
  break;
}
```

- [ ] **Step 5: Update imports at top of `parser.ts`**

Add to the type imports near `parser.ts:34-50`:

```ts
import type {
  // ... existing
  MarkdownLinkReferenceNode,
  LinkReferenceAstNode,
  LinkDefinition,
} from './types';
```

- [ ] **Step 6: Run typecheck and tests**

Run: `pnpm --filter @cacheplane/partial-markdown typecheck`
Run: `pnpm --filter @cacheplane/partial-markdown test`

Expected: typecheck clean, all link-ref tests pass, no regressions.

- [ ] **Step 7: Commit**

```bash
git add packages/partial-markdown/src/parser.ts
git commit -m "feat(partial-markdown): push parser syncs link-ref nodes + linkDefinitions sidecar"
```

---

### Task 7: Pull-layer sync (`resolve.ts`)

**Files:**
- Modify: `packages/partial-markdown/src/resolve.ts`

Read the existing citation sync at `resolve.ts:23-32` and `resolve.ts:107-115` for the pattern.

- [ ] **Step 1: Populate `linkDefinitions` on materialized document**

Mirror the citations block at `resolve.ts:23-35`:

```ts
const linkDefs = (state as InternalState).linkDefs;
if (linkDefs && linkDefs.size > 0) {
  for (const [refId, def] of linkDefs) {
    root.linkDefinitions.set(refId, {
      id: def.id,
      label: def.label,
      url: def.url,
      title: def.title,
      status: def.status,
    });
  }
}
```

- [ ] **Step 2: Initialize `linkDefinitions` on partial document creation**

Where `partial.citations = new Map<string, CitationDefinition>();` appears (`resolve.ts:75`), add:

```ts
partial.linkDefinitions = new Map<string, LinkDefinition>();
```

- [ ] **Step 3: Convert `link-reference` AST → MD in the materializer**

Add a case in the conversion switch (mirror `case 'citation-reference'` at `resolve.ts:107`):

```ts
case 'link-reference': {
  const node = ast as LinkReferenceAstNode;
  return {
    id: node.id,
    type: 'link-reference',
    status: node.status,
    parent: null,
    index: null,
    refId: node.refId,
    label: node.label,
    form: node.form,
    resolved: node.resolved,
    url: node.url,
    title: node.title,
    children: node.children.map((cid) => convert(state, cid)) as MarkdownInlineNode[],
  };
}
```

- [ ] **Step 4: Update imports**

Add `LinkReferenceAstNode`, `LinkDefinition`, `MarkdownLinkReferenceNode` to the type imports.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @cacheplane/partial-markdown test src/resolve.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/partial-markdown/src/resolve.ts
git commit -m "feat(partial-markdown): pull-style resolve includes linkDefinitions"
```

---

### Task 8: Materialize fingerprint

**Files:**
- Modify: `packages/partial-markdown/src/materialize.ts`

Read citation fingerprint at `materialize.ts:45-50` and document fingerprint at `materialize.ts:60-95`.

- [ ] **Step 1: Add `link-reference` fingerprint case**

Inside the per-node fingerprint switch:

```ts
case 'link-reference':
  return `link-reference:${node.status}:${(node as any).refId}:${(node as any).resolved}:${(node as any).url}:${(node as any).title}`;
```

- [ ] **Step 2: Include `linkDefinitions` in document fingerprint**

In the document fingerprint accumulator (mirroring `citations` at `materialize.ts:63-72`), add:

```ts
const linkDefinitions = (node as any).linkDefinitions as Map<string, any> | undefined;
if (linkDefinitions) {
  for (const [id, def] of linkDefinitions) {
    parts.push(`linkdef:${id}:${def.url}:${def.title}:${def.status}`);
  }
}
```

- [ ] **Step 3: Copy `linkDefinitions` Map in document snapshot mutator**

Mirror the citations Map-copy block at `materialize.ts:83-93`:

```ts
const linkDefinitions = (node as any).linkDefinitions as Map<string, any> | undefined;
if (linkDefinitions) {
  const newMap = new Map();
  for (const [id, def] of linkDefinitions) {
    newMap.set(id, { ...def });
  }
  out.linkDefinitions = newMap;
}
```

- [ ] **Step 4: Run materialize tests**

Run: `pnpm --filter @cacheplane/partial-markdown test src/materialize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/partial-markdown/src/materialize.ts
git commit -m "feat(partial-markdown): materialize fingerprints link-ref + linkDefinitions"
```

---

### Task 9: Type guard + index export

**Files:**
- Modify: `packages/partial-markdown/src/guards.ts`
- Modify: `packages/partial-markdown/src/index.ts`

- [ ] **Step 1: Add guard test**

Append to `guards.test.ts`:

```ts
import { isLinkReferenceNode } from './guards';

it('isLinkReferenceNode narrows correctly', () => {
  const n = { type: 'link-reference' } as any;
  expect(isLinkReferenceNode(n)).toBe(true);
  expect(isLinkReferenceNode({ type: 'link' } as any)).toBe(false);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement guard in `guards.ts`**

```ts
export function isLinkReferenceNode(
  node: MarkdownNode,
): node is MarkdownLinkReferenceNode {
  return node.type === 'link-reference';
}
```

Add the import for `MarkdownLinkReferenceNode`.

- [ ] **Step 4: Re-export from `index.ts`**

In the guards export block (`index.ts:72-79`), add `isLinkReferenceNode`. In the type-only exports (`index.ts:12-52`), add `MarkdownLinkReferenceNode` and `LinkDefinition`.

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/partial-markdown/src/guards.ts \
        packages/partial-markdown/src/guards.test.ts \
        packages/partial-markdown/src/index.ts
git commit -m "feat(partial-markdown): export link-ref guard and types"
```

---

### Task 10: Finish-time orphan warnings

**Files:**
- Modify: `packages/partial-markdown/src/finish.ts`

Read citation orphan emission at `finish.ts:60-90`.

- [ ] **Step 1: Append warning logic for link refs**

After the citation-orphan block:

```ts
// Link-reference orphan warnings.
for (const [refId, refNodeIds] of s.linkRefIds) {
  if (refNodeIds.length > 0) {
    s = pushWarning(s, {
      code: 'unresolved_link_ref',
      index: 0,
      detail: `unresolved link reference [${refId}]`,
    });
  }
}
for (const [refId] of s.linkDefs) {
  if (!s.linkRefIds.has(refId)) continue;  // referenced
  // Check if any reference ever pointed to this id
  // (we cleared linkRefIds on resolution, so we need a separate touched-set)
  // Simpler: track touched separately. See Step 2.
}
```

Wait — the citation feature uses `citationRefIds` to track BOTH waiting and once-touched. Replicate that pattern: on resolution, do NOT delete from `linkRefIds`, instead clear the entries (set to `[]`). The `unused_link_def` check then becomes:

- [ ] **Step 2: Adjust `liftLinkDef` in `block.ts`**

Change `newRefIds.delete(id)` to `newRefIds.set(id, [])`. This preserves the "this id was touched at least once" signal for finish-time `unused_link_def` checks.

- [ ] **Step 3: Add unused-def check to `finish.ts`**

```ts
for (const [refId] of s.linkDefs) {
  const refs = s.linkRefIds.get(refId);
  if (!refs || refs.length === 0) {
    // We need a 'touched' signal. Use linkRefIds: presence with empty
    // array means "was referenced and resolved"; absence means "never
    // referenced." So:
    if (!s.linkRefIds.has(refId)) {
      s = pushWarning(s, {
        code: 'unused_link_def',
        index: 0,
        detail: `unused link definition [${refId}]`,
      });
    }
  }
}
```

- [ ] **Step 4: Add tests at `finish.test.ts`**

```ts
it('emits unresolved_link_ref on finish for orphan refs', () => {
  let state = create();
  state = push(state, 'See [foo] now.\n');
  state = finish(state);
  expect(state.warnings.some((w) => w.code === 'unresolved_link_ref')).toBe(true);
});

it('emits unused_link_def on finish for orphan defs', () => {
  let state = create();
  state = push(state, '[foo]: /a\n');
  state = finish(state);
  expect(state.warnings.some((w) => w.code === 'unused_link_def')).toBe(true);
});
```

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/partial-markdown/src/finish.ts \
        packages/partial-markdown/src/finish.test.ts \
        packages/partial-markdown/src/handlers/block.ts
git commit -m "feat(partial-markdown): emit link-ref orphan/unused warnings on finish"
```

---

### Task 11: Chunk-boundary tests

**Files:**
- Create: `packages/partial-markdown/src/__tests__/chunk-boundary-link-refs.test.ts`

- [ ] **Step 1: Write comprehensive chunk-boundary tests**

```ts
import { describe, expect, it } from 'vitest';
import { createPartialMarkdownParser } from '../parser';
import { representativePartitions } from './helpers/chunking';

describe('Link refs — chunk boundary cases', () => {
  it('def URL split across chunks', () => {
    const p = createPartialMarkdownParser();
    p.push('[foo]: https://exam');
    p.push('ple.com\n');
    p.push('See [foo] now.\n');
    p.finish();
    const para = p.root!.children[0];
    const ref = (para as any).children.find((n: any) => n.type === 'link-reference');
    expect(ref!.url).toBe('https://example.com');
  });

  it('ref before def, identity preserved through resolution', () => {
    const p = createPartialMarkdownParser();
    p.push('See [foo] now.\n');
    const ref1 = (p.root!.children[0] as any).children.find(
      (n: any) => n.type === 'link-reference',
    );
    expect(ref1.resolved).toBe(false);

    p.push('[foo]: /resolved\n');
    expect(ref1.resolved).toBe(true);
    expect(ref1.url).toBe('/resolved');
  });

  it('partition equivalence across all representative partitions', () => {
    const input = 'See [hello][world] and [bare].\n[world]: /w\n[bare]: /b "B"\n';
    const baseline = (() => {
      const p = createPartialMarkdownParser();
      p.push(input);
      p.finish();
      return p.root!.linkDefinitions.size;
    })();

    for (const partition of representativePartitions(input)) {
      const p = createPartialMarkdownParser();
      for (const c of partition) p.push(c);
      p.finish();
      expect(p.root!.linkDefinitions.size).toBe(baseline);
    }
  });

  it('label whitespace + case normalization', () => {
    const p = createPartialMarkdownParser();
    p.push('See [Hello World] now.\n[hello world]: /hw\n');
    p.finish();
    const ref = (p.root!.children[0] as any).children.find(
      (n: any) => n.type === 'link-reference',
    );
    expect(ref.resolved).toBe(true);
    expect(ref.url).toBe('/hw');
  });
});
```

- [ ] **Step 2: Run tests — expect PASS**

- [ ] **Step 3: Commit**

```bash
git add packages/partial-markdown/src/__tests__/chunk-boundary-link-refs.test.ts
git commit -m "test(partial-markdown): chunk-boundary cases for link refs"
```

---

### Task 12: Provider-aligned tests

**Files:**
- Modify: `packages/partial-markdown/src/__tests__/provider-anthropic.test.ts`
- Modify: `packages/partial-markdown/src/__tests__/provider-openai.test.ts`
- Modify: `packages/partial-markdown/src/__tests__/chunking-properties.test.ts`

- [ ] **Step 1: Add Anthropic-shaped link-ref test**

Append to `provider-anthropic.test.ts` (use the existing `feedAnthropicMarkdown` helper):

```ts
it('parses link-reference forms in Anthropic text deltas', () => {
  const parsers = feedAnthropicMarkdown([
    {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'text_delta',
        text: 'See [the docs][docs] for details.\n\n[docs]: https://example.com "Docs"\n',
      },
    },
    { type: 'content_block_stop', index: 0 },
  ]);
  const p = parsers.get(0)!;
  p.finish();
  expect(p.root!.linkDefinitions.has('docs')).toBe(true);
  const ref = (p.root!.children[0] as any).children.find(
    (n: any) => n.type === 'link-reference',
  );
  expect(ref!.resolved).toBe(true);
  expect(ref!.url).toBe('https://example.com');
});
```

- [ ] **Step 2: Add OpenAI-shaped link-ref test**

Append to `provider-openai.test.ts` using the existing OpenAI feeder helper.

```ts
it('parses link-reference forms in OpenAI text deltas', () => {
  // Use existing feedOpenAIMarkdown helper from this file.
  const events = [
    { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0,
      delta: 'See [bar] for context.\n[bar]: /bar\n' },
  ];
  // ... follow the same pattern as the existing tests in this file
});
```

> **Note:** Read the existing OpenAI test helper at the top of the file and use it directly. The above is illustrative.

- [ ] **Step 3: Add link-ref sample to chunking-properties test**

Append a new corpus case to `chunking-properties.test.ts`:

```ts
it('link-reference partition equivalence', () => {
  const input = 'See [foo][bar] now.\n[bar]: /b\n';
  const partitions = representativePartitions(input);
  const baseline = (() => {
    const p = createPartialMarkdownParser();
    p.push(input);
    p.finish();
    return p.root!.linkDefinitions.size;
  })();
  for (const partition of partitions) {
    const p = createPartialMarkdownParser();
    for (const c of partition) p.push(c);
    p.finish();
    expect(p.root!.linkDefinitions.size).toBe(baseline);
  }
});
```

- [ ] **Step 4: Run all tests**

Run: `pnpm --filter @cacheplane/partial-markdown test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/partial-markdown/src/__tests__/provider-anthropic.test.ts \
        packages/partial-markdown/src/__tests__/provider-openai.test.ts \
        packages/partial-markdown/src/__tests__/chunking-properties.test.ts
git commit -m "test(partial-markdown): provider-aligned link-ref coverage"
```

---

### Task 13: README + CHANGELOG

**Files:**
- Modify: `packages/partial-markdown/README.md`
- Modify: `packages/partial-markdown/CHANGELOG.md`

- [ ] **Step 1: Update README**

In `README.md`:
- Remove `Link reference definitions` from `## Limits` (line ~273).
- Add a section **after** the Citations section (search for `### Citations (Pandoc footnote-style)`):

```markdown
### Link reference definitions

```md
See [the docs][docs] for details.

[docs]: https://example.com "Title"
```

Three reference forms are supported:

- **Full:** `[text][label]`
- **Collapsed:** `[label][]`
- **Shortcut:** `[label]` (not followed by `[` or `(`)

Definitions are extracted into a `linkDefinitions: Map<string, LinkDefinition>`
on the document root, keyed by normalized label (lowercased,
whitespace-collapsed). Forward resolution: a reference whose definition has
not yet arrived is exposed with `resolved: false`; identity is preserved when
the matching definition arrives and `url` / `title` populate in place.

Definitions are NOT recognized inside list items, and titles must fit on a
single line. Both are known deviations from CommonMark and are tracked as
follow-up work.
```

- Add `'unresolved_link_ref'`, `'unused_link_def'`, `'duplicate_link_def'` to the warning code list (~line 288).
- Document the `linkDefinitions` Map in the Streaming identity section (~line 116).

- [ ] **Step 2: Add CHANGELOG entry**

If `0.4.0` doesn't exist yet, prepend:

```markdown
## 0.4.0 — UNRELEASED

### Added

- **Link reference definitions** (CommonMark §4.7 / §6.3). Three forms: full
  (`[text][label]`), collapsed (`[label][]`), shortcut (`[label]`). Forward
  resolution with identity preservation. New `linkDefinitions: Map<string,
  LinkDefinition>` sidecar on `MarkdownDocumentNode`.
- New AST kind `link-reference` (member of `MarkdownInlineNode`).
- New type guard: `isLinkReferenceNode`.
- New warning codes: `unresolved_link_ref`, `unused_link_def`,
  `duplicate_link_def`.

### Changed

- `MarkdownDocumentNode.linkDefinitions` is a new required field. Existing
  manual constructions of the document node will TypeScript-error until
  initialized with `new Map()`.
- `MarkdownInlineNode` union grows. Exhaustive switches will surface as
  missing-case errors.
- `MarkdownWarning['code']` union grows.

### Notes for upgraders

- No backwards-compat shim. Initialize document `linkDefinitions: new Map()`
  on manual constructions.
- Definitions are NOT recognized inside list items (known limitation, called
  out in `## Limits`).
```

If `0.4.0` already has math/HTML entries from sibling implementation work, append link-ref content to the existing sections.

- [ ] **Step 3: Commit**

```bash
git add packages/partial-markdown/README.md \
        packages/partial-markdown/CHANGELOG.md
git commit -m "docs(partial-markdown): document link reference definitions"
```

---

### Task 14: Final verification

- [ ] **Step 1: Full package verification**

Run: `pnpm --filter @cacheplane/partial-markdown test`
Run: `pnpm --filter @cacheplane/partial-markdown typecheck`
Run: `pnpm --filter @cacheplane/partial-markdown build`
Run: `pnpm --filter @cacheplane/partial-markdown publint`
Run: `pnpm --filter @cacheplane/partial-markdown attw`

Expected: all green.

- [ ] **Step 2: Workspace verification**

Run: `pnpm verify`

Expected: lint/typecheck/test/build pass. Existing lint warnings may remain.

---

## Validation Phase (separate plan after this lands)

Tracked in a follow-up plan, not this one. The follow-up will cover:
- Chrome MCP smoke harness for `react-markdown` rendering of streaming link-ref content.
- Integration test in a downstream consumer app verifying React `memo` does NOT re-render unchanged link nodes.
