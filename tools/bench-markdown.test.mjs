// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertMarkdownComparisonOutputsEquivalent,
  assertMarkdownComparisonRunOutputsEquivalent,
  classifyMarkdownPairedMeasurements,
  collectMarkdownRetainedHeapSamples,
  createMarkdownComparisonProgress,
  createMarkdownComparisonReport,
  createMarkdownBenchmarkReport,
  formatMarkdownBenchmarkProgress,
  markdownComparisonExitCode,
  markdownComparisonCalibrationDuration,
  markdownRepetitionsForScenario,
  markdownComparisonWorkerError,
  markdownComparisonWorkerTimeoutMs,
  markdownBenchmarkWorkerError,
  markdownBenchmarkWorkerTimeoutMs,
  markdownMeasurementKey,
  markdownRetainedHeapRelativeMad,
  markdownScenarios,
  measureMarkdownRetainedHeapSample,
  parseMarkdownBenchmarkOptions,
  parseMarkdownComparisonOptions,
  parseMarkdownComparisonWorkerArguments,
  parseMarkdownWorkerArguments,
  selectMarkdownComparisonRetries,
  serializeMarkdownComparisonProgress,
  serializeMarkdownComparisonReport,
  writeMarkdownComparisonOutputAtomically,
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

test('defines the paired Markdown comparison package script', () => {
  const packageJson = JSON.parse(readFileSync(
    new URL('../package.json', import.meta.url),
    'utf8',
  ));

  assert.equal(
    packageJson.scripts['bench:markdown:compare'],
    'node tools/bench-markdown-compare.mjs',
  );
});

test('defines and invokes the deterministic benchmark test script', () => {
  const packageJson = JSON.parse(readFileSync(
    new URL('../package.json', import.meta.url),
    'utf8',
  ));

  assert.equal(
    packageJson.scripts['test:benchmarks'],
    'pnpm --filter @cacheplane/partial-markdown build && node --test tools/bench-*.test.mjs',
  );
  assert.equal(
    packageJson.scripts.test,
    "pnpm -r --workspace-concurrency=1 --filter './packages/*' test && pnpm test:benchmarks",
  );
});

test('defines the exact Markdown workload names', () => {
  const names = markdownWorkloads.map((workload) => workload.name);

  assert.deepEqual(names, [
    'mixed',
    'long-prose',
    'deep-list',
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
    assert.ok(Number.isInteger(expectedShape.minimumTreeDepth));
    assert.ok(expectedShape.minimumTreeDepth >= 1);
    assert.ok(Number.isInteger(expectedShape.minimumNodeCount));
    assert.ok(expectedShape.minimumNodeCount >= 1);
  }
});

test('includes real multibyte Markdown content in normal chunk equivalence coverage', () => {
  const workload = markdownWorkloads.find((entry) => entry.name === 'mixed');
  const chunker = markdownChunkers.find((entry) => entry.name === '64-byte');
  const { input, chunks } = chunksForMarkdownWorkload(workload, chunker);
  const chunkedParser = partialMarkdown.createPartialMarkdownParser();
  const wholeParser = partialMarkdown.createPartialMarkdownParser();

  for (const chunk of chunks) chunkedParser.push(chunk);
  chunkedParser.finish();
  wholeParser.push(input);
  wholeParser.finish();

  assert.ok(Buffer.byteLength(input) > Array.from(input).length);
  assert.ok(input.includes('\u03A9'));
  assert.ok(input.includes('\u0301'));
  assert.ok(input.includes('\u{1F680}'));
  assert.deepEqual(
    withoutParserAssignedIds(partialMarkdown.materialize(chunkedParser.root)),
    withoutParserAssignedIds(partialMarkdown.materialize(wholeParser.root)),
  );
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
  const workloadNames = ['mixed', 'long-prose', 'deep-list', 'wide-table', 'references'];
  const chunkerNames = ['whole', '64-byte', 'character'];
  const expectedSourceKeys = sourceImplementations.flatMap((implementation) => (
    workloadNames.flatMap((workload) => (
      chunkerNames.map((chunking) => `${implementation}/${workload}/${chunking}`)
    ))
  ));
  const expectedKeys = [
    ...expectedSourceKeys,
    'unchanged/wide-table/prepared',
    'leaf-change/wide-table/prepared',
    'citation-change/references/prepared',
  ];

  const keys = markdownScenarios.map(markdownMeasurementKey);

  assert.equal(markdownScenarios.length, 48);
  assert.equal(new Set(keys).size, 48);
  assert.deepEqual([...keys].sort(), [...expectedKeys].sort());
});

test('orders source scenarios by workload, chunker, then implementation', () => {
  const sourceImplementations = ['events', 'final-materialize', 'materialize-each'];
  const workloadNames = ['mixed', 'long-prose', 'deep-list', 'wide-table', 'references'];
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

test('parses the exact Markdown comparison CLI with stable defaults', () => {
  const defaults = parseMarkdownComparisonOptions(['baseline', 'candidate']);
  const configured = parseMarkdownComparisonOptions([
    '/tmp/baseline',
    '/tmp/candidate',
    '--samples',
    '101',
    '--output',
    '/tmp/markdown-comparison.json',
  ]);

  assert.deepEqual(defaults, {
    baselineRoot: 'baseline',
    candidateRoot: 'candidate',
    samples: 31,
    output: undefined,
  });
  assert.deepEqual(configured, {
    baselineRoot: '/tmp/baseline',
    candidateRoot: '/tmp/candidate',
    samples: 101,
    output: '/tmp/markdown-comparison.json',
  });
});

test('rejects invalid Markdown comparison CLI arguments', () => {
  const invalidArguments = [
    [],
    ['baseline'],
    ['--', 'baseline', 'candidate'],
    ['baseline', 'candidate', '--unknown', 'value'],
    ['baseline', 'candidate', '--samples'],
    ['baseline', 'candidate', '--samples', '--output', 'report.json'],
    ['baseline', 'candidate', '--samples', '29'],
    ['baseline', 'candidate', '--samples', '30.5'],
    ['baseline', 'candidate', '--samples', '31', '--samples', '101'],
    ['baseline', 'candidate', '--output'],
    ['baseline', 'candidate', '--output', '--samples', '31'],
    ['baseline', 'candidate', '--output', 'a.json', '--output', 'b.json'],
  ];

  for (const args of invalidArguments) {
    assert.throws(
      () => parseMarkdownComparisonOptions(args),
      /comparison|root|unknown|option value|duplicate|integer >= 30/i,
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
    ['events', 'wide-table', 'prepared', '3'],
    ['unchanged', 'wide-table', 'whole', '3'],
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

test('parses every exact Markdown comparison worker scenario', () => {
  for (const scenario of markdownScenarios) {
    const parsed = parseMarkdownComparisonWorkerArguments([
      '/tmp/baseline',
      '/tmp/candidate',
      scenario.implementation,
      scenario.workload,
      scenario.chunking,
      '30',
    ]);

    assert.deepEqual(parsed, {
      baselineRoot: '/tmp/baseline',
      candidateRoot: '/tmp/candidate',
      ...scenario,
      samples: 30,
    });
  }
});

test('rejects invalid Markdown comparison worker arguments', () => {
  const invalidArguments = [
    [],
    ['/tmp/baseline', '/tmp/candidate', 'events', 'mixed', 'whole'],
    ['/tmp/baseline', '/tmp/candidate', 'events', 'mixed', 'whole', '30', 'extra'],
    ['', '/tmp/candidate', 'events', 'mixed', 'whole', '30'],
    ['/tmp/baseline', '', 'events', 'mixed', 'whole', '30'],
    ['/tmp/baseline', '/tmp/candidate', 'unknown', 'mixed', 'whole', '30'],
    ['/tmp/baseline', '/tmp/candidate', 'events', 'mixed', 'whole', '29'],
    ['/tmp/baseline', '/tmp/candidate', 'events', 'mixed', 'whole', '30.5'],
  ];

  for (const args of invalidArguments) {
    assert.throws(
      () => parseMarkdownComparisonWorkerArguments(args),
      /comparison worker arguments|integer >= 30/i,
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

test('reports the one-hour Markdown comparison worker timeout clearly', () => {
  const timeoutError = Object.assign(new Error('spawnSync node ETIMEDOUT'), {
    code: 'ETIMEDOUT',
  });

  const error = markdownComparisonWorkerError(
    { error: timeoutError, status: null, stderr: '' },
    markdownScenarios[0],
  );

  assert.equal(markdownComparisonWorkerTimeoutMs, 3_600_000);
  assert.match(
    error.message,
    /events\/mixed\/whole timed out after 3600000ms/i,
  );
});

test('Markdown benchmark worker emits one valid measurement as JSON', () => {
  const scenario = {
    implementation: 'events',
    workload: 'deep-list',
    chunking: 'whole',
  };

  const { worker, measurement } = runMarkdownBenchmarkWorker(scenario);

  assert.equal(worker.status, 0, worker.stderr);
  assert.equal(worker.stderr, '');
  assert.deepEqual(
    {
      implementation: measurement.implementation,
      workload: measurement.workload,
      chunking: measurement.chunking,
    },
    {
      implementation: 'events',
      workload: 'deep-list',
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

test('Markdown benchmark worker phase-hardens prepared mutation measurements', () => {
  const scenario = {
    implementation: 'leaf-change',
    workload: 'wide-table',
    chunking: 'prepared',
  };

  const { worker, measurement } = runMarkdownBenchmarkWorker(scenario);

  assert.equal(worker.status, 0, worker.stderr);
  assert.equal(worker.stderr, '');
  assert.deepEqual(
    {
      implementation: measurement.implementation,
      workload: measurement.workload,
      chunking: measurement.chunking,
    },
    scenario,
  );
  assert.ok(Number.isInteger(measurement.repetitions));
  assert.ok(measurement.repetitions > 0);
  assert.equal(measurement.repetitions % 2, 0);
});

test('Markdown comparison worker emits one valid paired measurement as JSON', () => {
  const scenario = {
    implementation: 'events',
    workload: 'deep-list',
    chunking: 'whole',
  };

  const { worker, measurement } = runMarkdownComparisonWorker(scenario);

  assert.equal(worker.status, 0, worker.stderr);
  assert.equal(worker.stderr, '');
  assert.deepEqual(
    {
      implementation: measurement.implementation,
      workload: measurement.workload,
      chunking: measurement.chunking,
      samples: measurement.samples,
    },
    {
      implementation: 'events',
      workload: 'deep-list',
      chunking: 'whole',
      samples: 30,
    },
  );
  for (const field of ['bytes', 'chunks', 'samples', 'repetitions']) {
    assert.ok(Number.isInteger(measurement[field]), field);
    assert.ok(measurement[field] > 0, field);
  }
  for (const field of [
    'baselineMedianMs',
    'candidateMedianMs',
    'medianRatio',
    'lowerRatio',
    'upperRatio',
    'ratioRelativeMad',
  ]) {
    assert.ok(Number.isFinite(measurement[field]), field);
    assert.ok(measurement[field] >= 0, field);
  }
});

test('Markdown comparison worker phase-hardens prepared leaf-change measurements', () => {
  const scenario = {
    implementation: 'leaf-change',
    workload: 'wide-table',
    chunking: 'prepared',
  };

  const result = runMarkdownComparisonWorker(scenario);

  assertPreparedMutationWorkerResult(result, scenario);
});

test('Markdown comparison worker phase-hardens prepared citation-change measurements', () => {
  const scenario = {
    implementation: 'citation-change',
    workload: 'references',
    chunking: 'prepared',
  };

  const result = runMarkdownComparisonWorker(scenario);

  assertPreparedMutationWorkerResult(result, scenario);
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

test('creates and serializes a schema-v1 Markdown comparison report', () => {
  const measurements = createValidMarkdownComparisonMeasurements();

  const report = createMarkdownComparisonReport(measurements, 31);
  const serialized = serializeMarkdownComparisonReport(report);

  assert.deepEqual(report, {
    schemaVersion: 1,
    runtime: process.version,
    platform: `${process.platform}-${process.arch}`,
    initialSamples: 31,
    maxRegression: 0.10,
    measurements,
  });
  assert.equal(report.measurements.length, 48);
  assert.equal(new Set(report.measurements.map(markdownMeasurementKey)).size, 48);
  assert.ok(serialized.endsWith('\n'));
  assert.deepEqual(JSON.parse(serialized), report);
});

test('creates discriminated newline-terminated Markdown comparison progress', () => {
  const measurements = createValidMarkdownComparisonMeasurements().slice(0, 2);

  const initial = createMarkdownComparisonProgress([], 31);
  const progress = createMarkdownComparisonProgress(measurements, 31);
  const serialized = serializeMarkdownComparisonProgress(progress);

  assert.deepEqual(initial, {
    kind: 'markdown-comparison-progress',
    status: 'incomplete',
    runtime: process.version,
    platform: `${process.platform}-${process.arch}`,
    initialSamples: 31,
    completedMeasurements: [],
  });
  assert.deepEqual(progress, {
    kind: 'markdown-comparison-progress',
    status: 'incomplete',
    runtime: process.version,
    platform: `${process.platform}-${process.arch}`,
    initialSamples: 31,
    completedMeasurements: measurements,
  });
  assert.equal(progress.schemaVersion, undefined);
  assert.ok(serialized.endsWith('\n'));
  assert.deepEqual(JSON.parse(serialized), progress);
});

test('atomically replaces Markdown comparison progress with the final report', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'cacheplane-markdown-comparison-'));
  const output = join(directory, 'report.json');
  const progress = createMarkdownComparisonProgress(
    createValidMarkdownComparisonMeasurements().slice(0, 1),
    31,
  );
  const report = createMarkdownComparisonReport(
    createValidMarkdownComparisonMeasurements(),
    31,
  );
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(output, '{"stale":true}\n');

  await writeMarkdownComparisonOutputAtomically(
    output,
    serializeMarkdownComparisonProgress(progress),
  );
  const checkpoint = JSON.parse(await readFile(output, 'utf8'));
  await writeMarkdownComparisonOutputAtomically(
    output,
    serializeMarkdownComparisonReport(report),
  );
  const completed = JSON.parse(await readFile(output, 'utf8'));
  const files = await readdir(directory);

  assert.deepEqual(checkpoint, progress);
  assert.deepEqual(completed, report);
  assert.deepEqual(files, ['report.json']);
});

test('rejects invalid Markdown comparison reports', () => {
  const measurements = createValidMarkdownComparisonMeasurements();
  const unexpected = { ...measurements[0], implementation: 'unexpected' };

  assert.throws(
    () => createMarkdownComparisonReport(measurements.slice(1), 31),
    /measurement keys/i,
  );
  assert.throws(
    () => createMarkdownComparisonReport([
      measurements[0],
      ...measurements.slice(0, -1),
    ], 31),
    /duplicate measurement keys/i,
  );
  assert.throws(
    () => createMarkdownComparisonReport([unexpected, ...measurements.slice(1)], 31),
    /measurement keys/i,
  );
  for (const initialSamples of [Number.NaN, 0, 29, 31.5]) {
    assert.throws(
      () => createMarkdownComparisonReport(measurements, initialSamples),
      /initial samples.*integer >= 30/i,
    );
  }
});

test('rejects invalid Markdown paired measurement fields', () => {
  const integerFields = ['samples', 'repetitions', 'bytes', 'chunks'];
  const nonnegativeFields = [
    'baselineMedianMs',
    'candidateMedianMs',
    'medianRatio',
    'lowerRatio',
    'upperRatio',
    'ratioRelativeMad',
  ];

  for (const field of integerFields) {
    for (const value of [Number.POSITIVE_INFINITY, Number.NaN, -1, 0, 1.5]) {
      const measurements = createValidMarkdownComparisonMeasurements();
      measurements[0] = { ...measurements[0], [field]: value };

      assert.throws(
        () => createMarkdownComparisonReport(measurements, 31),
        new RegExp(`invalid ${field}`, 'i'),
      );
    }
  }
  for (const field of nonnegativeFields) {
    for (const value of [Number.POSITIVE_INFINITY, Number.NaN, -1]) {
      const measurements = createValidMarkdownComparisonMeasurements();
      measurements[0] = { ...measurements[0], [field]: value };

      assert.throws(
        () => createMarkdownComparisonReport(measurements, 31),
        new RegExp(`invalid ${field}`, 'i'),
      );
    }
  }
});

test('classifies Markdown paired measurements at the 10% regression threshold', () => {
  const passed = pairedMeasurement({ lowerRatio: 1.01, upperRatio: 1.10 });
  const inconclusive = pairedMeasurement({ lowerRatio: 1.10, upperRatio: 1.11 });
  const regression = pairedMeasurement({ lowerRatio: 1.100001, upperRatio: 1.20 });

  const classification = classifyMarkdownPairedMeasurements([
    passed,
    inconclusive,
    regression,
  ]);

  assert.deepEqual(classification, {
    passed: [passed],
    inconclusive: [inconclusive],
    regressions: [regression],
  });
});

test('selects every non-passing Markdown measurement for retry', () => {
  const passed = pairedMeasurement({ implementation: 'events', upperRatio: 1.05 });
  const inconclusive = pairedMeasurement({ implementation: 'final-materialize' });
  const regression = pairedMeasurement({
    implementation: 'materialize-each',
    lowerRatio: 1.11,
    upperRatio: 1.20,
  });

  const retries = selectMarkdownComparisonRetries([
    passed,
    inconclusive,
    regression,
  ]);

  assert.deepEqual(retries, [inconclusive, regression]);
});

test('returns Markdown comparison exit codes by final severity', () => {
  assert.equal(markdownComparisonExitCode({ regressions: [{}], inconclusive: [{}] }), 1);
  assert.equal(markdownComparisonExitCode({ regressions: [], inconclusive: [{}] }), 2);
  assert.equal(markdownComparisonExitCode({ regressions: [], inconclusive: [] }), 0);
});

test('calibrates paired Markdown repetitions from the slower five-run median', () => {
  const duration = markdownComparisonCalibrationDuration(
    [0.19, 0.20, 0.21, 0.22, 5.00],
    [0.24, 0.25, 0.26, 0.27, 0.28],
  );

  assert.equal(duration, 0.26);
});

test('paired prepared mutation measurements complete two-state cycles from either phase', () => {
  const scenarios = [
    { implementation: 'leaf-change', workload: 'wide-table', chunking: 'prepared' },
    { implementation: 'citation-change', workload: 'references', chunking: 'prepared' },
  ];
  const startingPhases = [0, 1];

  const measurements = scenarios.flatMap((scenario) => (
    startingPhases.map((startingPhase) => {
      const repetitions = markdownRepetitionsForScenario(20, scenario);
      const states = Array.from(
        { length: repetitions },
        (_, index) => (startingPhase + index) % 2,
      );

      return {
        scenario,
        startingPhase,
        repetitions,
        zeroStates: states.filter((state) => state === 0).length,
        oneStates: states.filter((state) => state === 1).length,
        endingPhase: (startingPhase + repetitions) % 2,
      };
    })
  ));

  for (const measurement of measurements) {
    assert.equal(measurement.repetitions, 4, measurement.scenario.implementation);
    assert.equal(measurement.zeroStates, 2, measurement.scenario.implementation);
    assert.equal(measurement.oneStates, 2, measurement.scenario.implementation);
    assert.equal(
      measurement.endingPhase,
      measurement.startingPhase,
      measurement.scenario.implementation,
    );
  }
});

test('Markdown repetition hardening preserves other scenarios and the 10,000 bound', () => {
  const scenarios = {
    source: { implementation: 'events', workload: 'mixed', chunking: 'whole' },
    unchanged: { implementation: 'unchanged', workload: 'wide-table', chunking: 'prepared' },
    leafChange: { implementation: 'leaf-change', workload: 'wide-table', chunking: 'prepared' },
    citationChange: {
      implementation: 'citation-change',
      workload: 'references',
      chunking: 'prepared',
    },
  };

  const repetitions = {
    source: markdownRepetitionsForScenario(20, scenarios.source),
    unchanged: markdownRepetitionsForScenario(20, scenarios.unchanged),
    leafChange: markdownRepetitionsForScenario(20, scenarios.leafChange),
    citationChangeAtMaximum: markdownRepetitionsForScenario(
      0,
      scenarios.citationChange,
    ),
  };

  assert.deepEqual(repetitions, {
    source: 3,
    unchanged: 3,
    leafChange: 4,
    citationChangeAtMaximum: 10_000,
  });
});

test('asserts Markdown comparison output equivalence with scenario context', () => {
  const scenario = markdownScenarios[0];

  assert.doesNotThrow(() => assertMarkdownComparisonOutputsEquivalent(
    { type: 'document', children: [] },
    { type: 'document', children: [] },
    scenario,
  ));
  assert.throws(
    () => assertMarkdownComparisonOutputsEquivalent(
      { type: 'document', children: [] },
      { type: 'document', children: [{ type: 'paragraph' }] },
      scenario,
    ),
    /events\/mixed\/whole.*outputs differ/i,
  );
});

test('prepared mutation comparison validates both consecutive toggle states from fresh runs', () => {
  const scenarios = [
    { implementation: 'leaf-change', workload: 'wide-table' },
    { implementation: 'citation-change', workload: 'references' },
  ];

  const results = scenarios.map(({ implementation, workload: workloadName }) => {
    const workload = markdownWorkloads.find((entry) => entry.name === workloadName);
    const baselineRun = createPreparedMaterializeRun(
      partialMarkdown,
      implementation,
      workload,
    );
    const candidateRun = createPreparedMaterializeRun(
      partialMarkdown,
      implementation,
      workload,
    );
    const scenario = { implementation, workload: workloadName, chunking: 'prepared' };
    let baselineCalls = 0;
    let candidateCalls = 0;

    const error = captureError(() => assertMarkdownComparisonRunOutputsEquivalent(
      () => {
        baselineCalls += 1;
        return baselineRun();
      },
      () => {
        candidateCalls += 1;
        const output = candidateRun();
        return candidateCalls === 2 ? { ...output, type: 'mismatch' } : output;
      },
      scenario,
    ));

    return { scenario, baselineCalls, candidateCalls, error };
  });

  for (const { scenario, baselineCalls, candidateCalls, error } of results) {
    assert.equal(baselineCalls, 2, scenario.implementation);
    assert.equal(candidateCalls, 2, scenario.implementation);
    assert.match(
      error.message,
      new RegExp(`${markdownMeasurementKey(scenario)}.*outputs differ`, 'i'),
    );
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

test('prepared mutation retained-heap samples balance both mutation directions', () => {
  const scenarios = [
    { implementation: 'leaf-change', workload: 'wide-table', chunking: 'prepared' },
    { implementation: 'citation-change', workload: 'references', chunking: 'prepared' },
  ];

  const results = scenarios.map((scenario) => {
    const directions = [];
    let phase = 0;
    const run = () => {
      const currentPhase = phase;
      phase = 1 - phase;
      return currentPhase;
    };
    const samples = collectMarkdownRetainedHeapSamples(run, scenario, (sampleRun) => {
      const previous = sampleRun();
      const current = sampleRun();
      directions.push(`${previous}->${current}`);
      return directions.length;
    });
    return { scenario, samples, directions };
  });

  for (const result of results) {
    assert.equal(result.samples.length, 8, result.scenario.implementation);
    assert.equal(
      result.directions.filter((direction) => direction === '0->1').length,
      4,
      result.scenario.implementation,
    );
    assert.equal(
      result.directions.filter((direction) => direction === '1->0').length,
      4,
      result.scenario.implementation,
    );
  }
});

test('retained-heap collection preserves source and prepared unchanged sampling', () => {
  const scenarios = [
    { implementation: 'events', workload: 'mixed', chunking: 'whole', runsPerSample: 1 },
    {
      implementation: 'unchanged',
      workload: 'wide-table',
      chunking: 'prepared',
      runsPerSample: 2,
    },
  ];

  const results = scenarios.map(({ runsPerSample, ...scenario }) => {
    let runCalls = 0;
    const samples = collectMarkdownRetainedHeapSamples(
      () => {
        runCalls += 1;
      },
      scenario,
      (sampleRun) => {
        for (let index = 0; index < runsPerSample; index += 1) sampleRun();
        return runCalls;
      },
    );
    return { scenario, samples, runCalls, runsPerSample };
  });

  for (const result of results) {
    assert.equal(result.samples.length, 7, result.scenario.implementation);
    assert.equal(
      result.runCalls,
      7 * result.runsPerSample,
      result.scenario.implementation,
    );
  }
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
    assert.ok(
      markdownTreeDepth(snapshot) >= workload.expectedShape.minimumTreeDepth,
      workload.name,
    );
    assert.ok(
      markdownNodeCount(snapshot) >= workload.expectedShape.minimumNodeCount,
      workload.name,
    );
  }
});

test('prepared cache scenarios use a broad materialized Markdown tree', () => {
  const preparedCacheScenarios = markdownScenarios.filter((scenario) => (
    scenario.chunking === 'prepared' && scenario.implementation !== 'citation-change'
  ));
  const workload = markdownWorkloads.find((entry) => entry.name === 'wide-table');
  const run = createSourceRun(partialMarkdown, 'final-materialize', [workload.input]);

  const snapshot = run();

  assert.deepEqual(
    preparedCacheScenarios.map((scenario) => scenario.workload),
    ['wide-table', 'wide-table'],
  );
  assert.ok(markdownNodeCount(snapshot) >= 1_500);
  assert.ok(markdownNodeCount(snapshot) >= workload.expectedShape.minimumNodeCount);
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
  const workload = markdownWorkloads.find((entry) => entry.name === 'wide-table');
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
  const workload = markdownWorkloads.find((entry) => entry.name === 'wide-table');
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

function createValidMarkdownComparisonMeasurements() {
  return markdownScenarios.map((scenario, index) => ({
    ...scenario,
    bytes: 1_000 + index,
    chunks: 1 + index,
    samples: index === 0 ? 31 : 101,
    repetitions: 3 + index,
    baselineMedianMs: 0.1 + index,
    candidateMedianMs: 0.1 + index,
    medianRatio: 1,
    lowerRatio: 0.99,
    upperRatio: 1.01,
    ratioRelativeMad: 0.01,
  }));
}

function pairedMeasurement(overrides = {}) {
  return {
    implementation: 'events',
    workload: 'mixed',
    chunking: 'whole',
    lowerRatio: 1.05,
    upperRatio: 1.15,
    ...overrides,
  };
}

function captureError(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

function runMarkdownComparisonWorker(scenario) {
  const workerPath = fileURLToPath(
    new URL('./bench-markdown-compare-worker.mjs', import.meta.url),
  );
  const worktreeRoot = fileURLToPath(new URL('..', import.meta.url));
  const worker = spawnSync(
    process.execPath,
    [
      workerPath,
      worktreeRoot,
      worktreeRoot,
      scenario.implementation,
      scenario.workload,
      scenario.chunking,
      '30',
    ],
    { encoding: 'utf8', timeout: markdownComparisonWorkerTimeoutMs },
  );
  const measurement = worker.status === 0 ? JSON.parse(worker.stdout) : undefined;

  return { worker, measurement };
}

function runMarkdownBenchmarkWorker(scenario) {
  const workerPath = fileURLToPath(
    new URL('./bench-markdown-worker.mjs', import.meta.url),
  );
  const worker = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      workerPath,
      scenario.implementation,
      scenario.workload,
      scenario.chunking,
      '3',
    ],
    { encoding: 'utf8', timeout: markdownBenchmarkWorkerTimeoutMs },
  );
  const measurement = worker.status === 0 ? JSON.parse(worker.stdout) : undefined;

  return { worker, measurement };
}

function assertPreparedMutationWorkerResult({ worker, measurement }, scenario) {
  assert.equal(worker.status, 0, worker.stderr);
  assert.equal(worker.stderr, '');
  assert.deepEqual(
    {
      implementation: measurement.implementation,
      workload: measurement.workload,
      chunking: measurement.chunking,
      samples: measurement.samples,
    },
    { ...scenario, samples: 30 },
  );
  assert.ok(Number.isInteger(measurement.repetitions));
  assert.ok(measurement.repetitions > 0);
  assert.equal(measurement.repetitions % 2, 0);
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

function markdownNodeCount(value) {
  const children = Array.isArray(value?.children) ? value.children : [];
  return 1 + children.reduce((count, child) => count + markdownNodeCount(child), 0);
}

function markdownTreeDepth(value) {
  const children = Array.isArray(value?.children) ? value.children : [];
  if (children.length === 0) return 0;
  return 1 + Math.max(...children.map(markdownTreeDepth));
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
