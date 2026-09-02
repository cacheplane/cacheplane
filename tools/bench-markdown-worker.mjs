// SPDX-License-Identifier: MIT
import { performance } from 'node:perf_hooks';
import {
  median,
  relativeMedianAbsoluteDeviation,
  repetitionsForTargetDuration,
} from './bench-lib.mjs';
import { parseMarkdownWorkerArguments } from './bench-markdown-lib.mjs';
import {
  createPreparedMaterializeRun,
  createSourceRun,
} from './bench-markdown-runtime.mjs';
import {
  chunksForMarkdownWorkload,
  markdownChunkers,
  markdownWorkloads,
} from './fixtures/markdown-workloads.mjs';

const { implementation, workload: workloadName, chunking, samples } = (
  parseMarkdownWorkerArguments(process.argv.slice(2))
);
if (typeof global.gc !== 'function') {
  throw new Error('Markdown benchmark workers require --expose-gc');
}

const partialMarkdown = await import('../packages/partial-markdown/dist/index.mjs');
const workload = markdownWorkloads.find((entry) => entry.name === workloadName);
const prepared = chunking === 'prepared';
const { input, chunks } = prepared
  ? { input: workload.input, chunks: [workload.input] }
  : chunksForMarkdownWorkload(
    workload,
    markdownChunkers.find((entry) => entry.name === chunking),
  );
const run = prepared
  ? createPreparedMaterializeRun(partialMarkdown, implementation, workload)
  : createSourceRun(partialMarkdown, implementation, chunks);

const warmupStart = performance.now();
let warmupIterations = 0;
do {
  run();
  warmupIterations += 1;
} while (performance.now() - warmupStart < 100 && warmupIterations < 1_000);

const calibrationDurations = [];
for (let iteration = 0; iteration < 5; iteration += 1) {
  const start = performance.now();
  run();
  calibrationDurations.push(performance.now() - start);
}
const repetitions = repetitionsForTargetDuration(median(calibrationDurations), 50);

const durations = [];
for (let iteration = 0; iteration < samples; iteration += 1) {
  const start = performance.now();
  for (let repetition = 0; repetition < repetitions; repetition += 1) run();
  durations.push((performance.now() - start) / repetitions);
}

const retainedHeapSamples = [];
for (let iteration = 0; iteration < 7; iteration += 1) {
  global.gc();
  const before = process.memoryUsage().heapUsed;
  globalThis.__cacheplaneMarkdownBenchmarkRetained = run();
  global.gc();
  retainedHeapSamples.push(Math.max(0, process.memoryUsage().heapUsed - before));
  globalThis.__cacheplaneMarkdownBenchmarkRetained = undefined;
}

process.stdout.write(JSON.stringify({
  implementation,
  workload: workload.name,
  chunking,
  bytes: Buffer.byteLength(input),
  chunks: chunks.length,
  repetitions,
  medianMs: median(durations),
  relativeMad: relativeMedianAbsoluteDeviation(durations),
  retainedHeapBytes: median(retainedHeapSamples),
  retainedHeapRelativeMad: relativeMedianAbsoluteDeviation(retainedHeapSamples),
}));
