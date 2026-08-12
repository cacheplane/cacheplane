// SPDX-License-Identifier: MIT
import { performance } from 'node:perf_hooks';
import { create, finish, push, resolve } from '../packages/json-stream/dist/index.mjs';
import {
  createPartialJsonParser,
  materialize,
} from '../packages/partial-json/dist/index.mjs';
import {
  median,
  relativeMedianAbsoluteDeviation,
  repetitionsForTargetDuration,
} from './bench-json-lib.mjs';
import {
  chunksForJsonWorkload,
  jsonChunkers,
  jsonWorkloads,
} from './fixtures/json-workloads.mjs';

const [implementation, workloadName, chunkingName, rawSamples] = process.argv.slice(2);
const workload = jsonWorkloads.find((entry) => entry.name === workloadName);
const chunker = jsonChunkers.find((entry) => entry.name === chunkingName);
const samples = Number(rawSamples);
if (!workload || !chunker || !Number.isInteger(samples)) throw new Error('Invalid benchmark worker arguments');
if (typeof global.gc !== 'function') throw new Error('Benchmark workers require --expose-gc');

const { input, chunks } = chunksForJsonWorkload(workload, chunker);
const run = createRun(implementation, chunks);
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
  globalThis.__cacheplaneBenchmarkRetained = run();
  global.gc();
  retainedHeapSamples.push(Math.max(0, process.memoryUsage().heapUsed - before));
  globalThis.__cacheplaneBenchmarkRetained = undefined;
}

process.stdout.write(JSON.stringify({
  implementation,
  workload: workload.name,
  chunking: chunker.name,
  bytes: Buffer.byteLength(input),
  chunks: chunks.length,
  repetitions,
  medianMs: median(durations),
  relativeMad: relativeMedianAbsoluteDeviation(durations),
  retainedHeapBytes: median(retainedHeapSamples),
  retainedHeapRelativeMad: relativeMedianAbsoluteDeviation(retainedHeapSamples),
}));

function createRun(name, inputChunks) {
  if (name === 'json-stream') {
    return () => {
      let state = create();
      for (const chunk of inputChunks) state = push(state, chunk);
      return resolve(finish(state));
    };
  }

  if (name === 'partial-json-events') {
    return () => {
      const parser = createPartialJsonParser();
      for (const chunk of inputChunks) parser.push(chunk);
      parser.finish();
      return parser.root;
    };
  }

  if (name === 'partial-json-final-materialize') {
    return () => {
      const parser = createPartialJsonParser();
      for (const chunk of inputChunks) parser.push(chunk);
      parser.finish();
      return parser.root ? materialize(parser.root) : null;
    };
  }

  if (name === 'partial-json-materialize-each') {
    return () => {
      const parser = createPartialJsonParser();
      for (const chunk of inputChunks) {
        parser.push(chunk);
        if (parser.root) materialize(parser.root);
      }
      parser.finish();
      return parser.root ? materialize(parser.root) : null;
    };
  }

  throw new Error(`Unknown implementation: ${name}`);
}
