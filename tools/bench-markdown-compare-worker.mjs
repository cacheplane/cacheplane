// SPDX-License-Identifier: MIT
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  median,
  medianConfidenceInterval,
  relativeMedianAbsoluteDeviation,
  repetitionsForTargetDuration,
} from './bench-lib.mjs';
import {
  assertMarkdownComparisonOutputsEquivalent,
  markdownComparisonCalibrationDuration,
  parseMarkdownComparisonWorkerArguments,
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

const {
  baselineRoot,
  candidateRoot,
  implementation,
  workload: workloadName,
  chunking,
  samples,
} = parseMarkdownComparisonWorkerArguments(process.argv.slice(2));
const scenario = { implementation, workload: workloadName, chunking };
const workload = markdownWorkloads.find((entry) => entry.name === workloadName);
const prepared = chunking === 'prepared';
const { input, chunks } = prepared
  ? { input: workload.input, chunks: [workload.input] }
  : chunksForMarkdownWorkload(
    workload,
    markdownChunkers.find((entry) => entry.name === chunking),
  );
const [baselineModule, candidateModule] = await Promise.all([
  loadPartialMarkdown(baselineRoot, 'baseline'),
  loadPartialMarkdown(candidateRoot, 'candidate'),
]);
const baselineRun = createScenarioRun(baselineModule);
const candidateRun = createScenarioRun(candidateModule);

assertMarkdownComparisonOutputsEquivalent(
  baselineRun(),
  candidateRun(),
  scenario,
);
warm(baselineRun);
warm(candidateRun);

const baselineCalibration = calibrate(baselineRun);
const candidateCalibration = calibrate(candidateRun);
const repetitions = repetitionsForTargetDuration(
  markdownComparisonCalibrationDuration(
    baselineCalibration,
    candidateCalibration,
  ),
  50,
);
const baselineDurations = [];
const candidateDurations = [];
const ratios = [];

for (let iteration = 0; iteration < samples; iteration += 1) {
  const pair = iteration % 2 === 0
    ? measurePair(baselineRun, candidateRun, repetitions)
    : measurePair(candidateRun, baselineRun, repetitions).reverse();
  baselineDurations.push(pair[0]);
  candidateDurations.push(pair[1]);
  ratios.push(pair[1] / pair[0]);
}

const ratioInterval = medianConfidenceInterval(ratios);
process.stdout.write(JSON.stringify({
  ...scenario,
  bytes: Buffer.byteLength(input),
  chunks: chunks.length,
  samples,
  repetitions,
  baselineMedianMs: median(baselineDurations),
  candidateMedianMs: median(candidateDurations),
  medianRatio: ratioInterval.median,
  lowerRatio: ratioInterval.lower,
  upperRatio: ratioInterval.upper,
  ratioRelativeMad: relativeMedianAbsoluteDeviation(ratios),
}));

async function loadPartialMarkdown(root, role) {
  const moduleUrl = pathToFileURL(
    resolve(root, 'packages/partial-markdown/dist/index.mjs'),
  );
  moduleUrl.searchParams.set('comparison', `${role}-${process.pid}-${Date.now()}`);
  return import(moduleUrl.href);
}

function createScenarioRun(module) {
  return prepared
    ? createPreparedMaterializeRun(module, implementation, workload)
    : createSourceRun(module, implementation, chunks);
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
  for (let iteration = 0; iteration < 5; iteration += 1) {
    durations.push(measure(run, 1));
  }
  return durations;
}

function measurePair(first, second, repetitions) {
  return [measure(first, repetitions), measure(second, repetitions)];
}

function measure(run, repetitions) {
  const start = performance.now();
  for (let repetition = 0; repetition < repetitions; repetition += 1) run();
  return (performance.now() - start) / repetitions;
}
