// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  markdownMeasurementKey,
  markdownScenarios,
} from './bench-markdown-lib.mjs';
import {
  chunksForMarkdownWorkload,
  markdownChunkers,
  markdownWorkloads,
} from './fixtures/markdown-workloads.mjs';

test('defines the exact Markdown workload names', () => {
  const names = markdownWorkloads.map((workload) => workload.name);

  assert.deepEqual(names, [
    'mixed',
    'long-prose',
    'deep-blockquote',
    'wide-table',
    'references',
  ]);
});

test('defines frozen deterministic non-empty Markdown inputs', async () => {
  const fixtureUrl = new URL('./fixtures/markdown-workloads.mjs?determinism', import.meta.url);

  const reloaded = await import(fixtureUrl.href);

  assert.ok(Object.isFrozen(markdownWorkloads));
  assert.deepEqual(
    reloaded.markdownWorkloads.map((workload) => workload.input),
    markdownWorkloads.map((workload) => workload.input),
  );
  for (const workload of markdownWorkloads) {
    assert.ok(Object.isFrozen(workload));
    assert.equal(typeof workload.input, 'string');
    assert.ok(workload.input.length > 0);
  }
});

test('defines expected Markdown shape metadata for every workload', () => {
  for (const workload of markdownWorkloads) {
    const { expectedShape } = workload;

    assert.ok(Object.isFrozen(expectedShape));
    assert.ok(Object.isFrozen(expectedShape.topLevelNodeTypes));
    assert.ok(expectedShape.topLevelNodeTypes.length > 0);
    assert.ok(expectedShape.topLevelNodeTypes.every((type) => typeof type === 'string'));
    assert.ok(Number.isInteger(expectedShape.minimumCitationCount));
    assert.ok(expectedShape.minimumCitationCount >= 0);
    assert.ok(Number.isInteger(expectedShape.minimumLinkDefinitionCount));
    assert.ok(expectedShape.minimumLinkDefinitionCount >= 0);
  }
});

test('defines whole, 64-byte, and bounded character chunkers', () => {
  const definitions = markdownChunkers.map(({ name, maxInputLength }) => ({
    name,
    maxInputLength,
  }));

  assert.deepEqual(definitions, [
    { name: 'whole', maxInputLength: undefined },
    { name: '64-byte', maxInputLength: undefined },
    { name: 'character', maxInputLength: 4_096 },
  ]);
});

test('all Markdown chunkers preserve every byte and emit no empty chunks', () => {
  for (const workload of markdownWorkloads) {
    for (const chunker of markdownChunkers) {
      const { input, chunks } = chunksForMarkdownWorkload(workload, chunker);

      assert.ok(chunks.length > 0);
      assert.ok(chunks.every((chunk) => chunk.length > 0));
      assert.deepEqual(
        Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
        Buffer.from(input),
      );
    }
  }
});

test('character chunking caps long effective inputs at exactly 4,096 characters', () => {
  const longWorkloads = markdownWorkloads.filter((workload) => workload.input.length >= 4_096);
  const chunker = markdownChunkers.find((entry) => entry.name === 'character');

  assert.ok(longWorkloads.length > 0);
  for (const workload of longWorkloads) {
    const { input, chunks } = chunksForMarkdownWorkload(workload, chunker);

    assert.equal(input.length, 4_096);
    assert.equal(chunks.length, 4_096);
    assert.ok(chunks.every((chunk) => chunk.length === 1));
  }
});

test('uses implementation/workload/chunking Markdown measurement keys', () => {
  const key = markdownMeasurementKey({
    implementation: 'events',
    workload: 'mixed',
    chunking: 'whole',
  });

  assert.equal(key, 'events/mixed/whole');
});

test('defines exactly 48 unique Markdown benchmark scenarios', () => {
  const sourceImplementations = ['events', 'final-materialize', 'materialize-each'];
  const workloadNames = ['mixed', 'long-prose', 'deep-blockquote', 'wide-table', 'references'];
  const chunkerNames = ['whole', '64-byte', 'character'];
  const expectedSourceKeys = sourceImplementations.flatMap((implementation) => (
    workloadNames.flatMap((workload) => (
      chunkerNames.map((chunking) => `${implementation}/${workload}/${chunking}`)
    ))
  ));
  const expectedKeys = [
    ...expectedSourceKeys,
    'unchanged/long-prose/prepared',
    'leaf-change/long-prose/prepared',
    'citation-change/references/prepared',
  ];

  const keys = markdownScenarios.map(markdownMeasurementKey);

  assert.equal(markdownScenarios.length, 48);
  assert.equal(new Set(keys).size, 48);
  assert.deepEqual([...keys].sort(), [...expectedKeys].sort());
});
