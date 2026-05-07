# Provider-Aligned Testing Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strengthen `@cacheplane/partial-json` and `@cacheplane/partial-markdown` tests against real OpenAI, Gemini, and Anthropic streaming behavior without overfitting parser contracts to one provider.

**Architecture:** Keep parser tests provider-agnostic, and add thin provider-shaped fixture tests that simulate each API's event/chunk surfaces. One parser instance must consume one logical output stream: OpenAI output item/function call, Gemini candidate/part stream, or Anthropic content block. Schema validation remains outside parser scope.

**Tech Stack:** TypeScript, Vitest, V8 coverage, optional `fast-check` for deterministic property-based chunk partition tests, existing pnpm workspace scripts.

---

## Source Docs

- OpenAI streaming responses: `https://developers.openai.com/api/docs/guides/streaming-responses`
- OpenAI structured outputs: `https://developers.openai.com/api/docs/guides/structured-outputs`
- Gemini structured outputs: `https://ai.google.dev/gemini-api/docs/structured-output`
- Gemini text streaming: `https://ai.google.dev/gemini-api/docs/text-generation`
- Anthropic streaming: `https://platform.claude.com/docs/en/build-with-claude/streaming`
- Anthropic tool use: `https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools`

## Scope Decisions

- Do not add live provider API tests to default CI. Use deterministic recorded fixture shapes only.
- Do not require every partial JSON prefix to be standalone-valid JSON.
- Do not assert provider chunk cadence. Anthropic currently emits one complete input key/value at a time for tool JSON; future models may stream finer chunks.
- Do not make Markdown CommonMark/GFM conformance the main objective. Use conformance fixtures only for supported syntax.
- Do not put schema semantics into `partial-json`; schema validation belongs to provider SDK helpers or application code after completion.

## File Structure

### `@cacheplane/partial-json`

- Create `packages/partial-json/src/__tests__/helpers/chunking.ts`
  - Deterministic chunk partition helpers used by property-style tests.
- Create `packages/partial-json/src/__tests__/provider-openai.test.ts`
  - OpenAI Responses event fixture tests for `response.output_text.delta`, `response.function_call_arguments.delta`, refusals, errors, and incomplete streams.
- Create `packages/partial-json/src/__tests__/provider-gemini.test.ts`
  - Gemini structured-output chunk fixtures using `chunk.text` / candidate part text.
- Create `packages/partial-json/src/__tests__/provider-anthropic.test.ts`
  - Anthropic `content_block_delta` fixtures for indexed `input_json_delta` tool-use blocks.
- Create `packages/partial-json/src/__tests__/chunking-properties.test.ts`
  - Single chunk, one-char chunks, selected partitions, and generated partitions all resolve equivalently.

### `@cacheplane/partial-markdown`

- Create `packages/partial-markdown/src/__tests__/helpers/chunking.ts`
  - Same deterministic chunk partition helpers, duplicated for now to avoid a test-only workspace package.
- Create `packages/partial-markdown/src/__tests__/provider-openai.test.ts`
  - OpenAI text-delta fixture tests for Markdown streams and refusal/error handling.
- Create `packages/partial-markdown/src/__tests__/provider-gemini.test.ts`
  - Gemini text streaming fixtures that validate line-boundary and mid-token Markdown chunks.
- Create `packages/partial-markdown/src/__tests__/provider-anthropic.test.ts`
  - Anthropic indexed text-block fixture tests, including multiple content blocks and ignored non-text blocks.
- Create `packages/partial-markdown/src/__tests__/chunking-properties.test.ts`
  - Whole-string, one-char, and deterministic partition equivalence for supported Markdown corpora.

### Workspace / CI

- Modify `package.json`
  - Add `fast-check` only if deterministic local partition tests are not enough.
- Modify both `vitest.config.ts` files later only if we decide to enforce coverage thresholds.
- Defer packed ESM/CJS consumer smoke tests to a follow-up plan after provider-shaped tests land.

---

### Task 1: Add deterministic chunking helpers

**Files:**
- Create: `packages/partial-json/src/__tests__/helpers/chunking.ts`
- Create: `packages/partial-markdown/src/__tests__/helpers/chunking.ts`

- [x] **Step 1: Write helper module for JSON tests**

```ts
export function chunksAt(input: string, cuts: number[]): string[] {
  const out: string[] = [];
  let prev = 0;
  for (const cut of cuts) {
    out.push(input.slice(prev, cut));
    prev = cut;
  }
  out.push(input.slice(prev));
  return out.filter((chunk) => chunk.length > 0);
}

export function oneCharChunks(input: string): string[] {
  return Array.from(input);
}

export function representativePartitions(input: string): string[][] {
  const mid = Math.floor(input.length / 2);
  return [
    [input],
    oneCharChunks(input),
    chunksAt(input, [1]),
    chunksAt(input, [mid]),
    chunksAt(input, [input.length - 1]),
  ];
}
```

- [x] **Step 2: Copy same helper for Markdown tests**

Keep the helper local to each package. Duplication is acceptable for test code and avoids a premature shared workspace package.

- [x] **Step 3: Run helper compile check**

Run: `pnpm --filter @cacheplane/partial-json test`

Expected: existing JSON tests pass.

Run: `pnpm --filter @cacheplane/partial-markdown test`

Expected: existing Markdown tests pass.

---

### Task 2: Add provider-shaped JSON stream tests

**Files:**
- Create: `packages/partial-json/src/__tests__/provider-openai.test.ts`
- Create: `packages/partial-json/src/__tests__/provider-gemini.test.ts`
- Create: `packages/partial-json/src/__tests__/provider-anthropic.test.ts`

- [x] **Step 1: Write OpenAI fixture tests first**

Test behaviors:
- Function argument deltas concatenate into one parser.
- Output text deltas can be parsed as JSON when the application requests JSON text.
- Refusal/error/completed events are handled by the adapter fixture, not fed into the parser.
- Incomplete stream leaves a useful partial tree and does not call `finish()` as success.

Core test shape:

```ts
import { describe, expect, it } from 'vitest';
import { createPartialJsonParser, materialize } from '../index';

type OpenAIEvent =
  | { type: 'response.function_call_arguments.delta'; output_index: number; item_id: string; delta: string }
  | { type: 'response.output_text.delta'; output_index: number; item_id: string; delta: string }
  | { type: 'response.refusal.delta'; delta: string }
  | { type: 'response.error'; error: { message: string } }
  | { type: 'response.completed' };

function feedOpenAIJson(events: OpenAIEvent[], kind: 'function' | 'text') {
  const parsers = new Map<string, ReturnType<typeof createPartialJsonParser>>();
  for (const event of events) {
    if (kind === 'function' && event.type !== 'response.function_call_arguments.delta') continue;
    if (kind === 'text' && event.type !== 'response.output_text.delta') continue;
    const parser = parsers.get(event.item_id) ?? createPartialJsonParser();
    parser.push(event.delta);
    parsers.set(event.item_id, parser);
  }
  return parsers;
}
```

- [x] **Step 2: Run and verify failure**

Run: `pnpm --filter @cacheplane/partial-json test src/__tests__/provider-openai.test.ts`

Expected: FAIL until the test file compiles and assertions are complete.

- [x] **Step 3: Complete tests using existing parser behavior**

No production changes expected. If production changes appear necessary, stop and isolate the missing parser behavior with a smaller failing test.

- [x] **Step 4: Add Gemini fixtures**

Use text chunks that Google documents as valid partial JSON strings concatenating into final JSON:

```ts
const chunks = ['{"sentiment":"positive"', ',"summary":"Great UI"}'];
```

Assert `materialize(parser.root)` exposes partial fields while streaming and final object after `finish()`.

- [x] **Step 5: Add Anthropic fixtures**

Use indexed content-block events:

```ts
type AnthropicEvent =
  | { type: 'content_block_delta'; index: number; delta: { type: 'input_json_delta'; partial_json: string } }
  | { type: 'content_block_delta'; index: number; delta: { type: 'text_delta'; text: string } }
  | { type: 'content_block_stop'; index: number };
```

Assert each `index` has isolated parser state and non-JSON text deltas are ignored.

- [x] **Step 6: Verify JSON package**

Run: `pnpm --filter @cacheplane/partial-json test`

Expected: all JSON tests pass.

---

### Task 3: Add provider-shaped Markdown stream tests

**Files:**
- Create: `packages/partial-markdown/src/__tests__/provider-openai.test.ts`
- Create: `packages/partial-markdown/src/__tests__/provider-gemini.test.ts`
- Create: `packages/partial-markdown/src/__tests__/provider-anthropic.test.ts`

- [x] **Step 1: Write OpenAI Markdown fixture tests**

Test behaviors:
- `response.output_text.delta` chunks feed a Markdown parser.
- Refusal/error events are not fed into the Markdown parser.
- Incomplete Markdown remains renderable before `finish()`.

Core fixture:

```ts
const events = [
  { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, delta: '# Report\n\n' },
  { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, delta: '- [x] Done\n' },
  { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, delta: '- [ ] Todo\n' },
] as const;
```

- [x] **Step 2: Run and verify failure**

Run: `pnpm --filter @cacheplane/partial-markdown test src/__tests__/provider-openai.test.ts`

Expected: FAIL until fixture adapter and assertions are complete.

- [x] **Step 3: Complete OpenAI Markdown tests with existing parser behavior**

Assert the final materialized root contains a heading and a task list.

- [x] **Step 4: Add Gemini Markdown fixture tests**

Use provider-shaped chunks from `generateContentStream` where each chunk has candidate content part text. Include:
- mid-emphasis chunking;
- line-boundary chunking;
- markdown table chunks if current parser behavior supports it.

- [x] **Step 5: Add Anthropic Markdown fixture tests**

Use multiple content blocks:
- index `0`: text Markdown;
- index `1`: tool-use JSON ignored by Markdown adapter;
- index `2`: another text block gets its own parser.

Assert parser isolation by block index.

- [x] **Step 6: Verify Markdown package**

Run: `pnpm --filter @cacheplane/partial-markdown test`

Expected: all Markdown tests pass, with the existing skipped blockquote-table test unchanged.

---

### Task 4: Add parser-core chunk partition tests

**Files:**
- Create: `packages/partial-json/src/__tests__/chunking-properties.test.ts`
- Create: `packages/partial-markdown/src/__tests__/chunking-properties.test.ts`

- [x] **Step 1: Add JSON partition equivalence tests**

Use representative complete JSON values:
- primitives;
- nested objects;
- arrays;
- escaped strings;
- Unicode escape strings;
- tool-call argument-like objects.

For each partition from `representativePartitions(input)`, assert:
- `state.error === null`;
- `resolve(state)` equals single-chunk parse;
- push-style `materialize(parser.root)` equals pull-style `resolve(state)`.

- [x] **Step 2: Run and verify failures if any**

Run: `pnpm --filter @cacheplane/partial-json test src/__tests__/chunking-properties.test.ts`

Expected: PASS if existing parser supports the cases. If any fail, record the exact case and decide whether it is a bug or unsupported edge.

- [x] **Step 3: Add Markdown partition equivalence tests**

Use supported Markdown samples:
- paragraph;
- heading + paragraph;
- task list;
- nested list;
- table;
- citation reference plus definition.

Assert whole-string and partitioned parses produce equivalent materialized output after `finish()`.

- [x] **Step 4: Verify Markdown partition tests**

Run: `pnpm --filter @cacheplane/partial-markdown test src/__tests__/chunking-properties.test.ts`

Expected: PASS for supported corpus. If table/citation partitioning exposes known line-buffer behavior, split that into explicit supported and known-limitation fixtures.

---

### Task 5: Add incomplete and interruption contract tests

**Files:**
- Modify: `packages/partial-json/src/__tests__/provider-openai.test.ts`
- Modify: `packages/partial-json/src/__tests__/provider-anthropic.test.ts`
- Modify: `packages/partial-markdown/src/__tests__/provider-openai.test.ts`
- Modify: `packages/partial-markdown/src/__tests__/provider-anthropic.test.ts`

- [x] **Step 1: JSON incomplete stream tests**

Cover:
- OpenAI length/content-filter equivalent: deltas stop before closing object.
- Anthropic `content_block_stop` never arrives.
- Empty delta before real JSON.

Expected: parser exposes partial materialized value, adapter does not treat stream as complete.

- [x] **Step 2: Markdown incomplete stream tests**

Cover:
- unfinished code fence;
- unfinished table header;
- unfinished list item;
- stream error after partial text.

Expected: partial tree remains renderable and `finish()` behavior is explicit.

- [x] **Step 3: Verify package tests**

Run: `pnpm test`

Expected: both packages pass.

---

### Task 6: Decide on `fast-check`

**Files:**
- Possibly modify: `package.json`
- Possibly modify: `pnpm-lock.yaml`
- Possibly modify: `packages/partial-json/src/__tests__/chunking-properties.test.ts`
- Possibly modify: `packages/partial-markdown/src/__tests__/chunking-properties.test.ts`

- [x] **Step 1: Evaluate deterministic tests first**

Run: `pnpm test:coverage`

Expected: provider-shaped and deterministic partition tests materially improve confidence without adding dependency cost.

- [x] **Step 2: Add `fast-check` only if deterministic partition tests are too narrow**

Decision: do not add `fast-check` in this slice. The deterministic partition tests now cover provider-shaped chunks, one-character chunks, middle cuts, start/end cuts, and supported Markdown corpora without adding dependency or CI runtime cost. Revisit after packed consumer smoke tests or if real fixtures expose missed chunk-boundary defects.

Run: `pnpm add -D fast-check -w`

Use seeded tests with low default run count so CI stays stable:

```ts
import fc from 'fast-check';

fc.assert(
  fc.property(fc.array(fc.integer({ min: 1, max: input.length - 1 })), (rawCuts) => {
    const cuts = [...new Set(rawCuts)].sort((a, b) => a - b);
    const chunks = chunksAt(input, cuts);
    // parse chunks and compare to baseline
  }),
  { seed: 20260507, numRuns: 50 },
);
```

- [x] **Step 3: Verify dependency decision**

No dependency was added, so `pnpm-lock.yaml` remains unchanged. Verified with `pnpm test`.

Run: `pnpm install --frozen-lockfile && pnpm test`

Expected: lockfile stable after dependency update, all tests pass.

---

### Task 7: Keep CI gates stable

**Files:**
- Possibly modify: `packages/partial-json/vitest.config.ts`
- Possibly modify: `packages/partial-markdown/vitest.config.ts`
- Possibly modify: `.github/workflows/ci.yml`

- [x] **Step 1: Do not add coverage thresholds yet**

Provider-aligned tests should land before thresholds. Coverage is already high, but thresholds would be noisy before the new oracle layer exists.

- [x] **Step 2: Re-run full local verification**

Run: `pnpm verify`

Expected: lint/typecheck/test/build pass. Existing lint warnings may remain unless a separate cleanup task is approved.

- [x] **Step 3: Re-run package checks**

Run:

```bash
pnpm --filter @cacheplane/partial-json publint
pnpm --filter @cacheplane/partial-json attw
pnpm --filter @cacheplane/partial-markdown publint
pnpm --filter @cacheplane/partial-markdown attw
```

Expected: all package checks pass.

---

## Follow-Up Plan

After these tests land, create a separate plan for packed consumer smoke tests:

- ESM consumer imports package tarball and runs parser smoke.
- CJS consumer requires package tarball and runs parser smoke.
- TypeScript consumer compiles against generated declaration files.
- CI runs this after `build`, `publint`, and `attw`.
