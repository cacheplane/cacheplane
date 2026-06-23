# partial-markdown B.1 — Backslash-escape handling

> **For agentic workers:** TDD. Each task is failing test → minimal impl → green → commit.

**Goal:** Backslash-escaped ASCII punctuation renders the **literal character** (backslash dropped) and does **not** trigger its markdown construct — `\*not bold\*` → literal `*not bold*`, `\$5` → literal `$5`, `` \` `` → literal backtick.

**Architecture:** Add a backslash-escape branch to the `parseInline` left-to-right scan in `packages/partial-markdown/src/handlers/inline.ts`, placed **after** the inline-code and math checks (so complete `` `code` `` / `$math$` / `\(math\)` spans still win) and **before** emphasis/strong/strikethrough/link recognition (so `\*` can't open emphasis).

**Scope decision (locked):** Escapes apply to all CommonMark-escapable ASCII punctuation **except** `(` `)` `[` `]` while `math.bracket` is enabled (the default) — those four stay reserved for the `\(…\)` / `\[…\]` math delimiters shipped in 0.4.x. When `math.bracket` is off, the four brackets are escapable too. `$` is always escapable (the math tokenizer already ignores an escaped `$`).

**Out of scope (separate later PRs):** B.2 optimistic unterminated-inline rendering; B.3 chunk-boundary fuzz/property suite.

**CommonMark reference:** escapable set is ASCII punctuation `` !"#$%&'()*+,-./:;<=>?@[\]^_`{|}~ ``. A backslash before any **non**-escapable char (letter, space, newline, EOL) is a literal backslash.

---

## Task 1: Escapable-set helper + the escape branch (TDD)

**Files:**
- Modify: `packages/partial-markdown/src/handlers/inline.ts`
- Test: `packages/partial-markdown/src/handlers/inline.test.ts` (existing; append a `describe('backslash escapes')`)

- [ ] **Step 1: Write failing tests**

Append to `inline.test.ts` (reuse the file's existing parse/materialize harness — match how sibling tests build a parser, push, finish, and assert on the materialized tree; the helper below assumes a `renderInline(src)` that returns the paragraph's child nodes — adapt to the file's actual helper):

```ts
describe('backslash escapes (B.1)', () => {
  it('escaped emphasis markers render literally, no emphasis', () => {
    const nodes = renderInline('\\*not bold\\*');
    expect(nodes.every((n) => n.type !== 'emphasis' && n.type !== 'strong')).toBe(true);
    expect(textOf(nodes)).toBe('*not bold*');
  });

  it('escaped underscore renders literally', () => {
    expect(textOf(renderInline('\\_x\\_'))).toBe('_x_');
  });

  it('escaped dollar renders literally, no math', () => {
    const nodes = renderInline('price \\$5');
    expect(nodes.every((n) => n.type !== 'math-inline')).toBe(true);
    expect(textOf(nodes)).toBe('price $5');
  });

  it('escaped backtick renders literally, no code span', () => {
    const nodes = renderInline('a \\` b');
    expect(nodes.every((n) => n.type !== 'inline-code')).toBe(true);
    expect(textOf(nodes)).toBe('a ` b');
  });

  it('escaped hash and tilde render literally', () => {
    expect(textOf(renderInline('a \\# \\~ b'))).toBe('a # ~ b');
  });

  it('escaped backslash renders one literal backslash', () => {
    expect(textOf(renderInline('a \\\\ b'))).toBe('a \\ b');
  });

  it('backslash before a non-punctuation char stays literal', () => {
    expect(textOf(renderInline('a\\b'))).toBe('a\\b');
  });

  it('escape works inside emphasis (inner re-parse)', () => {
    const nodes = renderInline('*a\\*b*');
    const em = nodes.find((n) => n.type === 'emphasis');
    expect(em).toBeTruthy();
    expect(textOf(em!.children)).toBe('a*b');
  });

  it('with math.bracket ON (default), \\[ is NOT escaped (stays math)', () => {
    // \[not link\] remains a math-display span under the default options.
    const nodes = renderInline('\\[not link\\]');
    expect(nodes.some((n) => n.type === 'math-display')).toBe(true);
  });

  it('with math.bracket OFF, \\[ \\] escape to literal brackets', () => {
    const nodes = renderInline('\\[not link\\]', { math: { bracket: false } });
    expect(nodes.some((n) => n.type === 'math-display')).toBe(false);
    expect(textOf(nodes)).toBe('[not link]');
  });
});
```

If the file has no `renderInline`/`textOf` helpers, add them near the top of the test file:
```ts
import { createPartialMarkdownParser, materialize } from '../index';
function renderInline(src: string, opts?: PartialMarkdownParserOptions) {
  const p = createPartialMarkdownParser(opts);
  p.push(src.endsWith('\n') ? src : src + '\n');
  p.finish();
  const doc = materialize(p.root) as any;
  return (doc?.children?.[0]?.children ?? []) as any[]; // first paragraph's inline children
}
function textOf(nodes: any[]): string {
  return nodes.map((n) => (n.text ?? (n.children ? textOf(n.children) : ''))).join('');
}
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @cacheplane/partial-markdown test -- inline`
Expected: the new `backslash escapes (B.1)` cases FAIL (backslash leaks / construct triggers); the `math.bracket ON` case may already pass.

- [ ] **Step 3: Implement the escape branch**

In `packages/partial-markdown/src/handlers/inline.ts`, add the escapable-set constant near the top (after imports):
```ts
// CommonMark ASCII-punctuation that a backslash escapes to its literal char.
const ESCAPABLE = new Set('!"#$%&\'()*+,-./:;<=>?@[]^_`{|}~\\'.split(''));
// Brackets reserved for \(…\) / \[…\] math delimiters when math.bracket is on.
const MATH_BRACKET_CHARS = new Set(['(', ')', '[', ']']);
```

Then, inside the `while (cursor.i < line.length)` scan loop, insert the escape branch **immediately after the inline-math block** (the `if (ch === '$' || ch === '\\') { … }` ending around line 87) and **before** the emphasis block (`if (ch === '*' || ch === '_' || ch === '~')`):
```ts
    // Backslash escape: \<punct> → literal <punct>, backslash dropped, no construct.
    // Runs after math so a complete \(…\)/\[…\] span still wins; the four bracket
    // chars stay reserved for math while math.bracket is enabled.
    if (ch === '\\') {
      const next = line[cursor.i + 1];
      if (
        next != null &&
        ESCAPABLE.has(next) &&
        !(s.options.math.bracket && MATH_BRACKET_CHARS.has(next))
      ) {
        s = appendInlineNode(s, parentId, makeText(s, parentId, next));
        cursor.i += 2;
        continue;
      }
    }
```

- [ ] **Step 4: Run tests, verify green**

Run: `pnpm --filter @cacheplane/partial-markdown test -- inline`
Expected: all `backslash escapes (B.1)` cases PASS. If `textOf` joins adjacent text nodes that the parser emits separately, that's fine (assertions concatenate).

- [ ] **Step 5: Full suite + lint + typecheck (no regressions)**

Run: `pnpm --filter @cacheplane/partial-markdown test && pnpm --filter @cacheplane/partial-markdown lint && pnpm --filter @cacheplane/partial-markdown typecheck`
Expected: green. Watch especially the existing math + emphasis + link-reference suites (the escape branch sits among them).

- [ ] **Step 6: Commit**

```bash
git add packages/partial-markdown/src/handlers/inline.ts packages/partial-markdown/src/handlers/inline.test.ts
git commit -m "feat(partial-markdown): backslash-escape inline punctuation (B.1)"
```

---

## Task 2: Version bump + changelog + release notes

**Files:**
- Modify: `packages/partial-markdown/package.json` (version)
- Modify: `packages/partial-markdown/CHANGELOG.md` (if present)

- [ ] **Step 1: Patch-bump the version** `0.4.1 → 0.4.2` in `packages/partial-markdown/package.json`.
- [ ] **Step 2: Add a CHANGELOG entry** for `0.4.2` describing B.1 escape handling (no external references).
- [ ] **Step 3: Commit**
```bash
git add packages/partial-markdown/package.json packages/partial-markdown/CHANGELOG.md
git commit -m "chore(release): partial-markdown 0.4.2 — backslash escapes"
```
(Release/tag is a separate manual step after PR merge, per RELEASING.md — not part of this plan.)

---

## Self-Review
- **Placement:** escape branch is after math (complete spans win) and before emphasis (so `\*` can't open emphasis). ✓
- **Bracket/math policy:** `()[]` excluded from escapes only while `math.bracket` is on; tests cover both on and off. ✓
- **`$` policy:** escapable; math tokenizer already ignores escaped `$`, so `\$5` → literal with no math. ✓
- **Non-punct backslash:** `a\b` stays literal `\b` (next not in ESCAPABLE → branch skipped → backslash flows to text run). ✓
- **Inner re-parse:** `parsedInner` re-runs `parseInline`, so escapes work inside emphasis/links. ✓
- **No placeholders:** the only adaptation point is the test harness helper, which the step shows how to add if absent. ✓
