// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareReports,
  comparisonExitCode,
  classifyPairedMeasurements,
  median,
  medianConfidenceInterval,
  parseOptions,
  relativeMedianAbsoluteDeviation,
  repetitionsForTargetDuration,
} from './bench-json-lib.mjs';
import * as benchmarkLibrary from './bench-json-lib.mjs';
import {
  chunksForJsonWorkload,
  jsonChunkers,
  jsonWorkloads,
} from './fixtures/json-workloads.mjs';

test('defines deterministic representative JSON workloads', () => {
  const names = jsonWorkloads.map((workload) => workload.name);

  assert.deepEqual(names, ['small', 'wide', 'deep', 'long-string', 'generative-ui']);
  for (const workload of jsonWorkloads) assert.deepEqual(JSON.parse(workload.input), JSON.parse(workload.input));
});

test('chunkers preserve every input byte', () => {
  const workload = jsonWorkloads.find((entry) => entry.name === 'generative-ui');

  for (const chunker of jsonChunkers) {
    const { input, chunks } = chunksForJsonWorkload(workload, chunker);

    assert.equal(chunks.join(''), input);
    assert.ok(chunks.every((chunk) => chunk.length > 0));
  }
});

test('bounds character chunking to a deterministic partial prefix', () => {
  const workload = jsonWorkloads.find((entry) => entry.name === 'long-string');
  const chunker = jsonChunkers.find((entry) => entry.name === 'character');

  const { input, chunks } = chunksForJsonWorkload(workload, chunker);

  assert.equal(input.length, 4_096);
  assert.equal(chunks.length, 4_096);
});

test('computes the median and relative median absolute deviation', () => {
  const samples = [9, 10, 10, 10, 11];

  assert.equal(median(samples), 10);
  assert.equal(relativeMedianAbsoluteDeviation(samples), 0);
});

test('calibrates repetitions to a bounded target duration', () => {
  assert.equal(repetitionsForTargetDuration(0.02), 1_000);
  assert.equal(repetitionsForTargetDuration(5), 4);
  assert.equal(repetitionsForTargetDuration(25), 1);
  assert.equal(repetitionsForTargetDuration(0), 10_000);
});

test('computes a confidence interval around a paired median', () => {
  const values = Array.from({ length: 31 }, (_, index) => index + 1);

  const interval = medianConfidenceInterval(values);

  assert.equal(interval.median, 16);
  assert.ok(interval.lower < interval.median);
  assert.ok(interval.upper > interval.median);
});

test('fails throughput regressions above ten percent', () => {
  const baseline = report({ medianMs: 100, retainedHeapBytes: 100_000, relativeMad: 0.01 });
  const candidate = report({ medianMs: 111, retainedHeapBytes: 100_000, relativeMad: 0.01 });

  const comparison = compareReports(baseline, candidate);

  assert.equal(comparison.regressions.length, 1);
  assert.equal(comparison.inconclusive.length, 0);
});

test('fails retained heap regressions above fifteen percent', () => {
  const baseline = report({ medianMs: 100, retainedHeapBytes: 100_000, relativeMad: 0.01 });
  const candidate = report({ medianMs: 100, retainedHeapBytes: 115_001, relativeMad: 0.01 });

  const comparison = compareReports(baseline, candidate);

  assert.equal(comparison.regressions.length, 1);
  assert.equal(comparison.inconclusive.length, 0);
});

test('marks comparisons with more than five percent variance inconclusive', () => {
  const baseline = report({ medianMs: 100, retainedHeapBytes: 100_000, relativeMad: 0.01 });
  const candidate = report({ medianMs: 130, retainedHeapBytes: 100_000, relativeMad: 0.051 });

  const comparison = compareReports(baseline, candidate);

  assert.equal(comparison.regressions.length, 0);
  assert.equal(comparison.inconclusive.length, 1);
});

test('rejects baseline comparisons with fewer than thirty samples', () => {
  expectError(() => parseOptions(['--samples', '29', '--baseline', 'before.json']), /at least 30/);
});

test('rejects reports from different runtimes or platforms', () => {
  const baseline = report({ medianMs: 100, retainedHeapBytes: 100_000, relativeMad: 0.01 });
  const candidate = {
    ...report({ medianMs: 100, retainedHeapBytes: 100_000, relativeMad: 0.01 }),
    runtime: 'different-runtime',
  };

  expectError(() => compareReports(baseline, candidate), /runtime/);
});

test('rejects missing or structurally different measurements', () => {
  const baseline = report({ medianMs: 100, retainedHeapBytes: 100_000, relativeMad: 0.01 });
  const missing = { ...baseline, measurements: [] };
  const changedChunks = structuredClone(baseline);
  changedChunks.measurements[0].chunks = 2;

  expectError(() => compareReports(baseline, missing), /measurement keys/);
  expectError(() => compareReports(baseline, changedChunks), /workload shape/);
});

test('compares calibrated sub-millisecond timing and skips only small retained heaps', () => {
  const baseline = report({ medianMs: 0.5, retainedHeapBytes: 1_000, relativeMad: 0.01 });
  const candidate = report({ medianMs: 0.8, retainedHeapBytes: 2_000, relativeMad: 0.01 });

  const comparison = compareReports(baseline, candidate);

  assert.equal(comparison.regressions.length, 1);
  assert.equal(comparison.inconclusive.length, 0);
  assert.equal(comparison.skipped.length, 1);
});

test('blocks the benchmark gate on regressions and inconclusive comparisons', () => {
  assert.equal(comparisonExitCode({ regressions: [], inconclusive: [], skipped: [] }), 0);
  assert.equal(comparisonExitCode({ regressions: [], inconclusive: ['noisy'], skipped: [] }), 2);
  assert.equal(comparisonExitCode({ regressions: ['slow'], inconclusive: [], skipped: [] }), 1);
  assert.equal(comparisonExitCode({ regressions: ['slow'], inconclusive: ['noisy'], skipped: [] }), 1);
});

test('classifies every paired measurement from its confidence interval', () => {
  const result = classifyPairedMeasurements([
    paired('pass', 0.95, 1.05),
    paired('retry', 1.05, 1.15),
    paired('fail', 1.11, 1.2),
  ]);

  assert.deepEqual(result.passed.map((entry) => entry.implementation), ['pass']);
  assert.deepEqual(result.inconclusive.map((entry) => entry.implementation), ['retry']);
  assert.deepEqual(result.regressions.map((entry) => entry.implementation), ['fail']);
});

test('escalates inconclusive paired comparisons through bounded sample counts', () => {
  assert.equal(typeof benchmarkLibrary.nextPairedSampleCount, 'function');

  assert.equal(benchmarkLibrary.nextPairedSampleCount(31), 101);
  assert.equal(benchmarkLibrary.nextPairedSampleCount(101), 301);
  assert.equal(benchmarkLibrary.nextPairedSampleCount(301), null);
});

function report(measurement) {
  return {
    schemaVersion: 2,
    runtime: 'v22.0.0',
    platform: 'test-platform',
    samples: 31,
    measurements: [{
      implementation: 'json-stream',
      workload: 'small',
      chunking: 'whole',
      bytes: 100,
      chunks: 1,
      retainedHeapRelativeMad: 0.01,
      ...measurement,
    }],
  };
}

function expectError(run, pattern) {
  assert.throws(run, pattern);
}

function paired(implementation, lowerRatio, upperRatio) {
  return { implementation, lowerRatio, upperRatio };
}
