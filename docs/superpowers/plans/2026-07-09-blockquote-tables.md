# Blockquote Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse markdown tables nested inside blockquotes, including streamed partial table rows.

**Architecture:** Keep one block parser path. Make table creation use the current block parent instead of always using the document root, and let blockquote inner lines flow through table lookahead/body-row logic.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, `@cacheplane/partial-markdown`.

---

### Task 1: Add Failing Blockquote Table Tests

**Files:**
- Modify: `packages/partial-markdown/src/__tests__/streaming-table.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that assert:

- `> | A | B |\n> | --- | --- |\n> | 1 | 2 |\n` finishes as one blockquote containing one table.
- Streaming `> | 1` after a quoted header and delimiter projects into the nested table.
- `> quote\n\n| A | B |\n| --- | --- |\n` remains a blockquote followed by a root table.

- [ ] **Step 2: Verify red**

Run:

```bash
./node_modules/.bin/vitest run packages/partial-markdown/src/__tests__/streaming-table.test.ts
```

Expected: at least one new test fails because quoted tables are parsed as paragraphs.

### Task 2: Make Table Creation Parent-Aware

**Files:**
- Modify: `packages/partial-markdown/src/handlers/block.ts`

- [ ] **Step 1: Add a table parent helper**

Use the top block container from `state.stack` when it is a blockquote; otherwise use `state.rootId`.

- [ ] **Step 2: Update `commitTable`**

Attach the table to the helper-derived parent instead of always appending to the document root.

- [ ] **Step 3: Verify green for complete quoted table**

Run the focused streaming-table test file.

### Task 3: Preserve Streaming Projection Inside Blockquotes

**Files:**
- Modify: `packages/partial-markdown/src/handlers/block.ts`

- [ ] **Step 1: Route quoted inner lines through block handling**

When a blockquote is open, process stripped inner lines through the existing block-recognition path so table lookahead and active table rows remain available.

- [ ] **Step 2: Verify green for partial quoted rows**

Run the focused streaming-table test file.

### Task 4: Broaden Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run focused parser suites**

```bash
./node_modules/.bin/vitest run packages/partial-markdown/src/__tests__/streaming-table.test.ts packages/partial-markdown/src/__tests__/streaming.test.ts packages/partial-markdown/src/__tests__/integration-0.2.test.ts
```

- [ ] **Step 2: Run package tests**

Prefer:

```bash
pnpm --filter @cacheplane/partial-markdown test
```

If pnpm install policy blocks execution, use:

```bash
./node_modules/.bin/vitest run packages/partial-markdown/src
```

- [ ] **Step 3: Review diff and commit**

Commit source and test changes separately from the design checkpoint.
