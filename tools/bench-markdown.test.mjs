// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createMarkdownBenchmarkReport,
  formatMarkdownBenchmarkProgress,
  markdownBenchmarkWorkerError,
  markdownBenchmarkWorkerTimeoutMs,
  markdownMeasurementKey,
  markdownRetainedHeapRelativeMad,
  markdownScenarios,
  measureMarkdownRetainedHeapSample,
  parseMarkdownBenchmarkOptions,
  parseMarkdownWorkerArguments,
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

test('orders source scenarios by workload, chunker, then implementation', () => {
  const sourceImplementations = ['events', 'final-materialize', 'materialize-each'];
  const workloadNames = ['mixed', 'long-prose', 'deep-blockquote', 'wide-table', 'references'];
  const chunkerNames = ['whole', '64-byte', 'character'];
  const expectedKeys = workloadNames.flatMap((workload) => (
    chunkerNames.flatMap((chunking) => (
      sourceImplementations.map((implementation) => (
        `${implementation}/${workload}/${chunking}`
      ))
    ))
  ));

  const keys = markdownScenarios.slice(0, 45).map(markdownMeasurementKey);

  assert.deepEqual(keys, expectedKeys);
});

test('parses Markdown benchmark options with stable defaults', () => {
  const defaults = parseMarkdownBenchmarkOptions([]);
  const configured = parseMarkdownBenchmarkOptions([
    '--',
    '--samples',
    '7',
    '--output',
    '/tmp/markdown.json',
  ]);

  assert.deepEqual(defaults, { samples: 31, output: undefined });
  assert.deepEqual(configured, { samples: 7, output: '/tmp/markdown.json' });
});

test('rejects invalid Markdown benchmark option values', () => {
  const invalidArguments = [
    ['--samples'],
    ['--samples', '--output', '/tmp/markdown.json'],
    ['--samples', '3.5'],
    ['--samples', '2'],
    ['--output'],
    ['--output', '--samples', '3'],
  ];

  for (const args of invalidArguments) {
    assert.throws(
      () => parseMarkdownBenchmarkOptions(args),
      /option value|integer >= 3/i,
      args.join(' '),
    );
  }
});

test('parses every exact Markdown worker scenario', () => {
  for (const scenario of markdownScenarios) {
    const parsed = parseMarkdownWorkerArguments([
      scenario.implementation,
      scenario.workload,
      scenario.chunking,
      '3',
    ]);

    assert.deepEqual(parsed, { ...scenario, samples: 3 });
  }
});

test('rejects invalid Markdown worker arguments', () => {
  const invalidArguments = [
    [],
    ['events', 'mixed', 'whole'],
    ['events', 'mixed', 'whole', '3', 'extra'],
    ['unknown', 'mixed', 'whole', '3'],
    ['events', 'unknown', 'whole', '3'],
    ['events', 'mixed', 'unknown', '3'],
    ['events', 'long-prose', 'prepared', '3'],
    ['unchanged', 'long-prose', 'whole', '3'],
    ['events', 'mixed', 'whole', '3.5'],
    ['events', 'mixed', 'whole', '2'],
  ];

  for (const args of invalidArguments) {
    assert.throws(
      () => parseMarkdownWorkerArguments(args),
      /worker arguments|integer >= 3/i,
      args.join(' '),
    );
  }
});

test('formats Markdown benchmark progress with the completed index and scenario key', () => {
  const progress = formatMarkdownBenchmarkProgress(1, 48, markdownScenarios[0]);

  assert.equal(progress, '[1/48] events/mixed/whole');
});

test('reports the five-minute Markdown worker timeout clearly', () => {
  const timeoutError = Object.assign(new Error('spawnSync node ETIMEDOUT'), {
    code: 'ETIMEDOUT',
  });

  const error = markdownBenchmarkWorkerError(
    { error: timeoutError, status: null, stderr: '' },
    markdownScenarios[0],
  );

  assert.equal(markdownBenchmarkWorkerTimeoutMs, 300_000);
  assert.match(
    error.message,
    /events\/mixed\/whole timed out after 300000ms/i,
  );
});

test('Markdown benchmark worker emits one valid measurement as JSON', () => {
  const workerPath = fileURLToPath(new URL('./bench-markdown-worker.mjs', import.meta.url));

  const worker = spawnSync(
    process.execPath,
    ['--expose-gc', workerPath, 'events', 'deep-blockquote', 'whole', '3'],
    { encoding: 'utf8', timeout: markdownBenchmarkWorkerTimeoutMs },
  );

  assert.equal(worker.status, 0, worker.stderr);
  assert.equal(worker.stderr, '');
  const measurement = JSON.parse(worker.stdout);
  assert.deepEqual(
    {
      implementation: measurement.implementation,
      workload: measurement.workload,
      chunking: measurement.chunking,
    },
    {
      implementation: 'events',
      workload: 'deep-blockquote',
      chunking: 'whole',
    },
  );
  for (const field of ['bytes', 'chunks', 'repetitions']) {
    assert.ok(Number.isInteger(measurement[field]), field);
    assert.ok(measurement[field] > 0, field);
  }
  for (const field of [
    'medianMs',
    'relativeMad',
    'retainedHeapBytes',
    'retainedHeapRelativeMad',
  ]) {
    assert.ok(Number.isFinite(measurement[field]), field);
    assert.ok(measurement[field] >= 0, field);
  }
});

test('creates a schema-v1 Markdown benchmark report for the exact scenario matrix', () => {
  const measurements = createValidMarkdownMeasurements();

  const report = createMarkdownBenchmarkReport(measurements, 7);

  assert.deepEqual(report, {
    schemaVersion: 1,
    runtime: process.version,
    platform: `${process.platform}-${process.arch}`,
    samples: 7,
    measurements,
  });
  assert.equal(report.measurements.length, 48);
  assert.equal(
    new Set(report.measurements.map(markdownMeasurementKey)).size,
    48,
  );
});

test('rejects missing, duplicate, and unexpected Markdown measurements', () => {
  const measurements = createValidMarkdownMeasurements();
  const unexpected = {
    ...measurements[0],
    implementation: 'unexpected',
  };

  assert.throws(
    () => createMarkdownBenchmarkReport(measurements.slice(1), 3),
    /measurement keys/i,
  );
  assert.throws(
    () => createMarkdownBenchmarkReport([measurements[0], ...measurements.slice(0, -1)], 3),
    /duplicate measurement keys/i,
  );
  assert.throws(
    () => createMarkdownBenchmarkReport([unexpected, ...measurements.slice(1)], 3),
    /measurement keys/i,
  );
});

test('rejects invalid Markdown report sample counts', () => {
  for (const samples of [Number.NaN, 0, 2, 3.5]) {
    assert.throws(
      () => createMarkdownBenchmarkReport(createValidMarkdownMeasurements(), samples),
      /samples.*integer >= 3/i,
    );
  }
});

test('rejects invalid Markdown timing and heap measurement fields', () => {
  const fields = [
    'medianMs',
    'relativeMad',
    'retainedHeapBytes',
    'retainedHeapRelativeMad',
  ];

  for (const field of fields) {
    for (const value of [Number.POSITIVE_INFINITY, Number.NaN, -1]) {
      const measurements = createValidMarkdownMeasurements();
      measurements[0] = { ...measurements[0], [field]: value };

      assert.throws(
        () => createMarkdownBenchmarkReport(measurements, 3),
        new RegExp(`invalid ${field}`, 'i'),
      );
    }
  }
});

test('rejects non-positive or fractional Markdown measurement counts', () => {
  const fields = ['bytes', 'chunks', 'repetitions'];

  for (const field of fields) {
    for (const value of [Number.POSITIVE_INFINITY, Number.NaN, -1, 0, 1.5]) {
      const measurements = createValidMarkdownMeasurements();
      measurements[0] = { ...measurements[0], [field]: value };

      assert.throws(
        () => createMarkdownBenchmarkReport(measurements, 3),
        new RegExp(`invalid ${field}`, 'i'),
      );
    }
  }
});

test('reports retained-heap instability when a zero median hides positive samples', () => {
  const sparsePositive = [0, 0, 0, 0, 32_768, 65_536, 131_072];
  const stableNonzero = [90, 95, 100, 100, 100, 105, 110];

  assert.equal(markdownRetainedHeapRelativeMad(sparsePositive), 1);
  assert.equal(markdownRetainedHeapRelativeMad([0, 0, 0, 0, 0, 0, 0]), 0);
  assert.equal(markdownRetainedHeapRelativeMad(stableNonzero), 0.05);
});

test('prepared retained-heap samples keep previous and current snapshots through the final GC', () => {
  const snapshots = [{ id: 'previous' }, { id: 'current' }];
  const heapSizes = [1_000, 1_128];
  const events = [];
  let retained;

  const retainedBytes = measureMarkdownRetainedHeapSample(
    () => {
      const snapshot = snapshots.shift();
      events.push(`run:${snapshot.id}`);
      return snapshot;
    },
    {
      retainPrevious: true,
      collectGarbage() {
        events.push(`gc:${retained.previous.id}/${retained.current?.id ?? 'none'}`);
      },
      heapUsed() {
        events.push('heap');
        return heapSizes.shift();
      },
      retain(value) {
        retained = value;
        events.push(`retain:${value.previous.id}/${value.current?.id ?? 'none'}`);
      },
    },
  );

  assert.equal(retainedBytes, 128);
  assert.deepEqual(retained, {
    previous: { id: 'previous' },
    current: { id: 'current' },
  });
  assert.deepEqual(events, [
    'run:previous',
    'retain:previous/none',
    'gc:previous/none',
    'heap',
    'run:current',
    'gc:previous/current',
    'heap',
  ]);
});

test('source retained-heap samples retain only the new result', () => {
  const result = { id: 'source' };
  const events = [];
  let retained;

  const retainedBytes = measureMarkdownRetainedHeapSample(
    () => {
      events.push('run');
      return result;
    },
    {
      retainPrevious: false,
      collectGarbage() {
        events.push('gc');
      },
      heapUsed: (() => {
        const heapSizes = [2_000, 2_064];
        return () => {
          events.push('heap');
          return heapSizes.shift();
        };
      })(),
      retain(value) {
        retained = value;
        events.push('retain');
      },
    },
  );

  assert.equal(retainedBytes, 64);
  assert.equal(retained, result);
  assert.deepEqual(events, ['gc', 'heap', 'run', 'retain', 'gc', 'heap']);
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

test('prepared citation-change runs mutate one citation leaf on a stable live root', () => {
  const workload = markdownWorkloads.find((entry) => entry.name === 'references');
  const fixtureInput = workload.input;
  const instrumented = instrumentPartialMarkdown();

  const run = createPreparedMaterializeRun(instrumented.module, 'citation-change', workload);
  const mutationSnapshots = [run(), run(), run()];
  const sourceRoots = instrumented.materializedRoots;
  const snapshots = instrumented.materializedSnapshots;
  const changedCitationId = findChangedMapKey(
    snapshots[0].citations,
    snapshots[1].citations,
  );
  const values = mutationSnapshots.map((snapshot) => (
    findText(snapshot.citations.get(changedCitationId)).text
  ));

  assert.equal(instrumented.parserCreations(), 1);
  assert.equal(sourceRoots.length, 4);
  assert.equal(snapshots.length, 4);
  assert.ok(mutationSnapshots.every((snapshot, index) => snapshot === snapshots[index + 1]));
  assert.equal(workload.input, fixtureInput);
  assert.ok(sourceRoots.every((root) => root === sourceRoots[0]));
  assert.equal(values[0], values[2]);
  assert.notEqual(values[0], values[1]);
  assert.equal(values[0].length, values[1].length);

  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = snapshots[index - 1];
    const current = snapshots[index];

    assert.notEqual(current, previous);
    assert.notEqual(current.citations, previous.citations);
    assert.notEqual(
      current.citations.get(changedCitationId),
      previous.citations.get(changedCitationId),
    );
    assert.notEqual(
      findText(current.citations.get(changedCitationId)),
      findText(previous.citations.get(changedCitationId)),
    );
    assert.equal(current.linkDefinitions, previous.linkDefinitions);
    for (const [citationId, definition] of previous.citations) {
      if (citationId !== changedCitationId) {
        assert.equal(current.citations.get(citationId), definition);
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

function createValidMarkdownMeasurements() {
  return markdownScenarios.map((scenario, index) => ({
    ...scenario,
    bytes: 1_000 + index,
    chunks: 1 + index,
    repetitions: 3 + index,
    medianMs: 0.1 + index,
    relativeMad: 0.01,
    retainedHeapBytes: 2_000 + index,
    retainedHeapRelativeMad: 0.02,
  }));
}

function instrumentPartialMarkdown() {
  let parserCreations = 0;
  const materializedRoots = [];
  const materializedSnapshots = [];

  return {
    module: {
      createPartialMarkdownParser(options) {
        parserCreations += 1;
        return partialMarkdown.createPartialMarkdownParser(options);
      },
      materialize(root) {
        materializedRoots.push(root);
        const snapshot = partialMarkdown.materialize(root);
        materializedSnapshots.push(snapshot);
        return snapshot;
      },
    },
    materializedRoots,
    materializedSnapshots,
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
