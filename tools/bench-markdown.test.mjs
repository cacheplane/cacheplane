// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  markdownMeasurementKey,
  markdownScenarios,
} from './bench-markdown-lib.mjs';
import {
  createPreparedMaterializeRun,
  createSourceRun,
} from './bench-markdown-runtime.mjs';
import {
  chunksForMarkdownWorkload,
  markdownChunkers,
  markdownWorkloads,
} from './fixtures/markdown-workloads.mjs';

const partialMarkdown = await import('../packages/partial-markdown/dist/index.mjs');

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

test('64-byte chunking preserves astral code points across byte boundaries', () => {
  const astralCharacter = '\u{1F600}';
  const workload = { input: `${'a'.repeat(63)}${astralCharacter}tail` };
  const chunker = markdownChunkers.find((entry) => entry.name === '64-byte');

  const { input, chunks } = chunksForMarkdownWorkload(workload, chunker);

  assert.equal(chunks.join(''), input);
  assert.ok(chunks.every((chunk) => Buffer.byteLength(chunk) <= 64));
  assert.ok(chunks.every((chunk) => !hasLoneSurrogate(chunk)));
});

test('character chunking caps long effective inputs at exactly 4,096 characters', () => {
  const longWorkloads = markdownWorkloads.filter((workload) => (
    Array.from(workload.input).length >= 4_096
  ));
  const chunker = markdownChunkers.find((entry) => entry.name === 'character');

  assert.ok(longWorkloads.length > 0);
  for (const workload of longWorkloads) {
    const { input, chunks } = chunksForMarkdownWorkload(workload, chunker);

    assert.equal(Array.from(input).length, 4_096);
    assert.equal(chunks.length, 4_096);
    assert.ok(chunks.every((chunk) => Array.from(chunk).length === 1));
  }
});

test('character chunking keeps an astral code point intact at the prefix boundary', () => {
  const astralCharacter = '\u{1F600}';
  const workload = { input: `${'a'.repeat(4_095)}${astralCharacter}trailing text` };
  const chunker = markdownChunkers.find((entry) => entry.name === 'character');

  const { input, chunks } = chunksForMarkdownWorkload(workload, chunker);

  assert.equal(Array.from(input).length, 4_096);
  assert.ok(input.endsWith(astralCharacter));
  assert.equal(chunks.join(''), input);
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

test('all Markdown chunkings materialize like a whole push of the same effective input', () => {
  let comparisons = 0;

  for (const workload of markdownWorkloads) {
    for (const chunker of markdownChunkers) {
      const { input, chunks } = chunksForMarkdownWorkload(workload, chunker);
      const chunkedParser = partialMarkdown.createPartialMarkdownParser();
      const wholeParser = partialMarkdown.createPartialMarkdownParser();

      for (const chunk of chunks) chunkedParser.push(chunk);
      chunkedParser.finish();
      wholeParser.push(input);
      wholeParser.finish();

      assert.deepEqual(
        withoutParserAssignedIds(partialMarkdown.materialize(chunkedParser.root)),
        withoutParserAssignedIds(partialMarkdown.materialize(wholeParser.root)),
        `${workload.name}/${chunker.name}`,
      );
      comparisons += 1;
    }
  }

  assert.equal(comparisons, 15);
});

test('complete whole-input workloads match their expected Markdown shapes', () => {
  for (const workload of markdownWorkloads) {
    const run = createSourceRun(partialMarkdown, 'final-materialize', [workload.input]);

    const snapshot = run();

    assert.deepEqual(
      snapshot.children.map((node) => node.type),
      workload.expectedShape.topLevelNodeTypes,
      workload.name,
    );
    assert.ok(
      snapshot.citations.size >= workload.expectedShape.minimumCitationCount,
      workload.name,
    );
    assert.ok(
      snapshot.linkDefinitions.size >= workload.expectedShape.minimumLinkDefinitionCount,
      workload.name,
    );
  }
});

test('source runs create a parser per invocation and execute the selected materialization policy', () => {
  const chunks = ['alpha', ' beta'];
  const expectations = [
    { implementation: 'events', materializeCalls: 0 },
    { implementation: 'final-materialize', materializeCalls: 2 },
    { implementation: 'materialize-each', materializeCalls: 6 },
  ];

  for (const expectation of expectations) {
    const instrumented = instrumentPartialMarkdown();
    const run = createSourceRun(
      instrumented.module,
      expectation.implementation,
      chunks,
    );

    const first = run();
    const second = run();

    assert.equal(instrumented.parserCreations(), 2, expectation.implementation);
    assert.equal(
      instrumented.materializedRoots.length,
      expectation.materializeCalls,
      expectation.implementation,
    );
    assert.equal(first.type, 'document');
    assert.equal(second.type, 'document');
    assert.notEqual(first, second);
  }
});

test('source runs reject unknown implementations', () => {
  assert.throws(
    () => createSourceRun(partialMarkdown, 'unknown', ['input']),
    /unknown Markdown source implementation/i,
  );
});

test('prepared unchanged runs parse and prime once then reuse snapshot identity', () => {
  const workload = markdownWorkloads.find((entry) => entry.name === 'long-prose');
  const instrumented = instrumentPartialMarkdown();

  const run = createPreparedMaterializeRun(instrumented.module, 'unchanged', workload);
  const first = run();
  const second = run();
  const third = run();

  assert.equal(instrumented.parserCreations(), 1);
  assert.equal(instrumented.materializedRoots.length, 4);
  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(
    new Set(instrumented.materializedRoots).size,
    1,
  );
});

test('prepared leaf-change runs alternate an equal-length text mutation on every invocation', () => {
  const workload = markdownWorkloads.find((entry) => entry.name === 'long-prose');
  const fixtureInput = workload.input;
  const instrumented = instrumentPartialMarkdown();

  const run = createPreparedMaterializeRun(instrumented.module, 'leaf-change', workload);
  const first = run();
  const second = run();
  const third = run();
  const fourth = run();
  const values = [first, second, third, fourth].map((snapshot) => findText(snapshot).text);

  assert.equal(instrumented.parserCreations(), 1);
  assert.equal(instrumented.materializedRoots.length, 5);
  assert.equal(new Set(instrumented.materializedRoots).size, 1);
  assert.equal(workload.input, fixtureInput);
  assert.notEqual(first, second);
  assert.notEqual(second, third);
  assert.notEqual(third, fourth);
  assert.notEqual(values[0], values[1]);
  assert.equal(values[0], values[2]);
  assert.equal(values[1], values[3]);
  assert.equal(values[0].length, values[1].length);
});

test('prepared citation-change runs replace only the changing citation source path', () => {
  const workload = markdownWorkloads.find((entry) => entry.name === 'references');
  const fixtureInput = workload.input;
  const instrumented = instrumentPartialMarkdown();

  const run = createPreparedMaterializeRun(instrumented.module, 'citation-change', workload);
  const first = run();
  const second = run();
  const third = run();
  const sourceRoots = instrumented.materializedRoots;
  const changedCitationId = findChangedMapKey(sourceRoots[0].citations, sourceRoots[1].citations);
  const values = [first, second, third].map((snapshot) => (
    findText(snapshot.citations.get(changedCitationId)).text
  ));

  assert.equal(instrumented.parserCreations(), 1);
  assert.equal(sourceRoots.length, 4);
  assert.equal(workload.input, fixtureInput);
  assert.notEqual(first, second);
  assert.notEqual(second, third);
  assert.notEqual(sourceRoots[0], sourceRoots[1]);
  assert.notEqual(sourceRoots[1], sourceRoots[2]);
  assert.notEqual(sourceRoots[2], sourceRoots[3]);
  assert.notEqual(sourceRoots[0].citations, sourceRoots[1].citations);
  assert.notEqual(sourceRoots[1].citations, sourceRoots[2].citations);
  assert.notEqual(sourceRoots[2].citations, sourceRoots[3].citations);
  assert.equal(sourceRoots[0].linkDefinitions, sourceRoots[1].linkDefinitions);
  assert.equal(sourceRoots[1].linkDefinitions, sourceRoots[2].linkDefinitions);
  assert.equal(sourceRoots[2].linkDefinitions, sourceRoots[3].linkDefinitions);
  assert.equal(
    findText(sourceRoots[0].citations.get(changedCitationId)),
    findText(sourceRoots[1].citations.get(changedCitationId)),
  );
  assert.equal(
    findText(sourceRoots[1].citations.get(changedCitationId)),
    findText(sourceRoots[2].citations.get(changedCitationId)),
  );
  assert.equal(
    findText(sourceRoots[2].citations.get(changedCitationId)),
    findText(sourceRoots[3].citations.get(changedCitationId)),
  );
  assert.equal(values[0], values[2]);
  assert.notEqual(values[0], values[1]);
  assert.equal(values[0].length, values[1].length);

  for (let index = 1; index < sourceRoots.length; index += 1) {
    const previous = sourceRoots[index - 1].citations;
    const current = sourceRoots[index].citations;

    assert.notEqual(current.get(changedCitationId), previous.get(changedCitationId));
    for (const [citationId, definition] of previous) {
      if (citationId !== changedCitationId) {
        assert.equal(current.get(citationId), definition);
      }
    }
  }
});

test('prepared mutation runs reject missing targets and unknown implementations', () => {
  assert.throws(
    () => createPreparedMaterializeRun(
      partialMarkdown,
      'leaf-change',
      { name: 'long-prose', input: '---\n' },
    ),
    /text leaf/i,
  );
  assert.throws(
    () => createPreparedMaterializeRun(
      partialMarkdown,
      'citation-change',
      { name: 'references', input: 'No citations.\n' },
    ),
    /citation-body text leaf/i,
  );
  assert.throws(
    () => createPreparedMaterializeRun(partialMarkdown, 'unknown', markdownWorkloads[0]),
    /unknown prepared Markdown implementation/i,
  );
});

function hasLoneSurrogate(input) {
  for (let index = 0; index < input.length; index += 1) {
    const codeUnit = input.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const nextCodeUnit = input.charCodeAt(index + 1);
      if (nextCodeUnit < 0xDC00 || nextCodeUnit > 0xDFFF) return true;
      index += 1;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return true;
    }
  }
  return false;
}

function instrumentPartialMarkdown() {
  let parserCreations = 0;
  const materializedRoots = [];

  return {
    module: {
      createPartialMarkdownParser(options) {
        parserCreations += 1;
        return partialMarkdown.createPartialMarkdownParser(options);
      },
      materialize(root) {
        materializedRoots.push(root);
        return partialMarkdown.materialize(root);
      },
    },
    materializedRoots,
    parserCreations: () => parserCreations,
  };
}

function findText(value) {
  if (value?.type === 'text') return value;
  if (!Array.isArray(value?.children)) return null;

  for (const child of value.children) {
    const match = findText(child);
    if (match) return match;
  }
  return null;
}

function findChangedMapKey(previous, current) {
  const changedKeys = [...previous.keys()].filter((key) => (
    previous.get(key) !== current.get(key)
  ));

  assert.equal(changedKeys.length, 1);
  return changedKeys[0];
}

function withoutParserAssignedIds(value) {
  if (Array.isArray(value)) return value.map(withoutParserAssignedIds);
  if (value instanceof Map) {
    return new Map([...value].map(([key, entry]) => [key, withoutParserAssignedIds(entry)]));
  }
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, entry]) => key !== 'id' || typeof entry !== 'number')
      .map(([key, entry]) => [key, withoutParserAssignedIds(entry)]),
  );
}
