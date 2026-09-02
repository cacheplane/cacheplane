// SPDX-License-Identifier: MIT

const mixed = [
  '# Streaming Markdown benchmark',
  '',
  'This paragraph mixes **strong text**, *emphasis*, `inline code`, and a [direct link](https://example.com).',
  '',
  '- Parse incrementally',
  '- Preserve stable identities',
  '- Materialize snapshots',
  '',
  '> A representative blockquote keeps the fixture close to generated answers.',
  '',
  '```js',
  'const result = parser.push(chunk);',
  '```',
  '',
  '| Phase | Responsibility | Status |',
  '| :--- | :--- | ---: |',
  '| Parse | Consume streamed source | active |',
  '| Render | Materialize the current tree | ready |',
].join('\n');

const longProse = Array.from({ length: 96 }, (_, index) => (
  `Passage ${index + 1} follows a streamed Markdown document through parsing, identity preservation, ` +
  'and materialization while keeping the prose deterministic enough for repeatable local measurements.'
)).join(' ');

const deepBlockquote = [
  `${'> '.repeat(32)}The deepest quoted paragraph remains visible while every prefix is streamed.`,
  `${'> '.repeat(24)}A second quoted line exercises repeated delimiter and text transitions.`,
  `${'> '.repeat(16)}The nesting then narrows without introducing unrelated block types.`,
  `${'> '.repeat(8)}The final quoted line closes the deterministic workload.`,
].join('\n');

const tableColumns = Array.from({ length: 24 }, (_, index) => `Column ${index + 1}`);
const wideTable = [
  `| ${tableColumns.join(' | ')} |`,
  `| ${tableColumns.map((_, index) => index % 3 === 0 ? ':---' : index % 3 === 1 ? ':---:' : '---:').join(' | ')} |`,
  ...Array.from({ length: 32 }, (_, rowIndex) => (
    `| ${tableColumns.map((_, columnIndex) => `r${rowIndex + 1}c${columnIndex + 1}`).join(' | ')} |`
  )),
].join('\n');

const references = [
  'The parser resolves [the architecture guide][architecture], [streaming notes][streaming], and [API details][api].',
  'The same paragraph cites the benchmark design [^design], parser behavior [^parser], and measurement notes [^measurements].',
  '',
  '[architecture]: https://example.com/architecture "Architecture guide"',
  '[streaming]: https://example.com/streaming "Streaming notes"',
  '[api]: https://example.com/api "API details"',
  '',
  '[^design]: The benchmark design fixes the workload and scenario matrix.',
  '[^parser]: The parser consumes partial input and retains node identities.',
  '[^measurements]: The harness records deterministic scenario metadata.',
].join('\n');

export const markdownWorkloads = Object.freeze([
  workload('mixed', mixed, ['heading', 'paragraph', 'list', 'blockquote', 'code-block', 'table']),
  workload('long-prose', longProse, ['paragraph']),
  workload('deep-blockquote', deepBlockquote, ['blockquote']),
  workload('wide-table', wideTable, ['table']),
  workload('references', references, ['paragraph'], 3, 3),
]);

export const markdownChunkers = Object.freeze([
  Object.freeze({ name: 'whole', split: (input) => [input] }),
  Object.freeze({ name: '64-byte', split: (input) => splitEvery(input, 64) }),
  Object.freeze({ name: 'character', maxInputLength: 4_096, split: (input) => Array.from(input) }),
]);

/**
 * Builds the effective input and chunks for a Markdown benchmark workload.
 *
 * @param {{ input: string }} markdownWorkload Markdown fixture to split.
 * @param {{ maxInputLength?: number, split: (input: string) => string[] }} chunker Chunk strategy.
 * @returns {{ input: string, chunks: string[] }} Effective input and its non-empty chunks.
 */
export function chunksForMarkdownWorkload(markdownWorkload, chunker) {
  const input = chunker.maxInputLength === undefined
    ? markdownWorkload.input
    : markdownWorkload.input.slice(0, chunker.maxInputLength);
  return { input, chunks: chunker.split(input) };
}

function workload(
  name,
  input,
  topLevelNodeTypes,
  minimumCitationCount = 0,
  minimumLinkDefinitionCount = 0,
) {
  return Object.freeze({
    name,
    input,
    expectedShape: Object.freeze({
      topLevelNodeTypes: Object.freeze(topLevelNodeTypes),
      minimumCitationCount,
      minimumLinkDefinitionCount,
    }),
  });
}

function splitEvery(input, size) {
  return Array.from(
    { length: Math.ceil(input.length / size) },
    (_, index) => input.slice(index * size, (index + 1) * size),
  );
}
