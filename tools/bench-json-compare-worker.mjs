// SPDX-License-Identifier: MIT
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  median,
  medianConfidenceInterval,
  relativeMedianAbsoluteDeviation,
  repetitionsForTargetDuration,
} from './bench-json-lib.mjs';
import {
  chunksForJsonWorkload,
  jsonChunkers,
  jsonWorkloads,
} from './fixtures/json-workloads.mjs';

const [baselineRoot, candidateRoot, implementation, workloadName, chunkingName, rawSamples] =
  process.argv.slice(2);
const workload = jsonWorkloads.find((entry) => entry.name === workloadName);
const chunker = jsonChunkers.find((entry) => entry.name === chunkingName);
const samples = Number(rawSamples);
if (!workload || !chunker || !Number.isInteger(samples)) throw new Error('Invalid comparison worker arguments');

const [baselineModules, candidateModules] = await Promise.all([
  loadModules(baselineRoot),
  loadModules(candidateRoot),
]);
const { input, chunks } = chunksForJsonWorkload(workload, chunker);
const baseline = createRun(implementation, chunks, baselineModules);
const candidate = createRun(implementation, chunks, candidateModules);

warm(baseline);
warm(candidate);
const repetitions = repetitionsForTargetDuration(
  Math.max(calibrate(baseline), calibrate(candidate)),
  50,
);
const ratios = [];
const baselineDurations = [];
const candidateDurations = [];

for (let iteration = 0; iteration < samples; iteration += 1) {
  const pair = iteration % 2 === 0
    ? measurePair(baseline, candidate, repetitions)
    : measurePair(candidate, baseline, repetitions).reverse();
  baselineDurations.push(pair[0]);
  candidateDurations.push(pair[1]);
  ratios.push(pair[1] / pair[0]);
}

const ratioInterval = medianConfidenceInterval(ratios);

process.stdout.write(JSON.stringify({
  implementation,
  workload: workload.name,
  chunking: chunker.name,
  bytes: Buffer.byteLength(input),
  chunks: chunks.length,
  repetitions,
  baselineMedianMs: median(baselineDurations),
  candidateMedianMs: median(candidateDurations),
  medianRatio: ratioInterval.median,
  lowerRatio: ratioInterval.lower,
  upperRatio: ratioInterval.upper,
  ratioRelativeMad: relativeMedianAbsoluteDeviation(ratios),
}));

async function loadModules(root) {
  const cacheBuster = `?comparison=${encodeURIComponent(root)}`;
  const kernelUrl = `${pathToFileURL(resolve(root, 'packages/json-stream/dist/index.mjs')).href}${cacheBuster}`;
  const facadeUrl = `${pathToFileURL(resolve(root, 'packages/partial-json/dist/index.mjs')).href}${cacheBuster}`;
  const [kernel, facade] = await Promise.all([import(kernelUrl), import(facadeUrl)]);
  return { kernel, facade };
}

function createRun(name, inputChunks, modules) {
  if (name === 'json-stream') {
    return () => {
      let state = modules.kernel.create();
      for (const chunk of inputChunks) state = modules.kernel.push(state, chunk);
      return modules.kernel.resolve(modules.kernel.finish(state));
    };
  }

  return () => {
    const parser = modules.facade.createPartialJsonParser();
    for (const chunk of inputChunks) {
      parser.push(chunk);
      if (name === 'partial-json-materialize-each' && parser.root) {
        modules.facade.materialize(parser.root);
      }
    }
    parser.finish();
    if (name === 'partial-json-events') return parser.root;
    return parser.root ? modules.facade.materialize(parser.root) : null;
  };
}

function warm(run) {
  const start = performance.now();
  let iterations = 0;
  do {
    run();
    iterations += 1;
  } while (performance.now() - start < 100 && iterations < 1_000);
}

function calibrate(run) {
  const durations = [];
  for (let iteration = 0; iteration < 5; iteration += 1) durations.push(measure(run, 1));
  return median(durations);
}

function measurePair(first, second, repetitions) {
  return [measure(first, repetitions), measure(second, repetitions)];
}

function measure(run, repetitions) {
  const start = performance.now();
  for (let repetition = 0; repetition < repetitions; repetition += 1) run();
  return (performance.now() - start) / repetitions;
}
