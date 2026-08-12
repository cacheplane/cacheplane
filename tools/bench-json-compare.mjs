// SPDX-License-Identifier: MIT
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyPairedMeasurements,
  nextPairedSampleCount,
} from './bench-json-lib.mjs';
import { jsonChunkers, jsonWorkloads } from './fixtures/json-workloads.mjs';

const [baselineRoot, candidateRoot = process.cwd(), rawSamples = '31'] = process.argv.slice(2);
const samples = Number(rawSamples);
if (!baselineRoot) throw new Error('Usage: pnpm bench:json:compare <baseline-root> [candidate-root] [samples]');
if (!Number.isInteger(samples) || samples < 30) throw new Error('Paired comparisons require at least 30 samples');

const worker = fileURLToPath(new URL('./bench-json-compare-worker.mjs', import.meta.url));
const implementations = [
  'json-stream',
  'partial-json-events',
  'partial-json-final-materialize',
  'partial-json-materialize-each',
];
const measurements = [];

for (const workload of jsonWorkloads) {
  for (const chunker of jsonChunkers) {
    for (const implementation of implementations) {
      measurements.push(runComparison(implementation, workload.name, chunker.name, samples));
    }
  }
}

let sampleCount = samples;
let classification = classifyPairedMeasurements(measurements);
let retrySampleCount = nextPairedSampleCount(sampleCount);
while (classification.inconclusive.length > 0 && retrySampleCount !== null) {
  console.warn(
    `Retrying ${classification.inconclusive.length} inconclusive comparisons with ${retrySampleCount} paired samples...`,
  );
  for (const entry of classification.inconclusive) {
    const index = measurements.findIndex((candidate) => key(candidate) === key(entry));
    measurements[index] = runComparison(
      entry.implementation,
      entry.workload,
      entry.chunking,
      retrySampleCount,
    );
  }
  sampleCount = retrySampleCount;
  classification = classifyPairedMeasurements(measurements);
  retrySampleCount = nextPairedSampleCount(sampleCount);
}

console.table(measurements.map((entry) => ({
  implementation: entry.implementation,
  workload: entry.workload,
  chunking: entry.chunking,
  baselineMs: entry.baselineMedianMs.toFixed(2),
  candidateMs: entry.candidateMedianMs.toFixed(2),
  change: `${((entry.medianRatio - 1) * 100).toFixed(1)}%`,
  interval: `${((entry.lowerRatio - 1) * 100).toFixed(1)}%..${((entry.upperRatio - 1) * 100).toFixed(1)}%`,
})));

const { regressions, inconclusive } = classifyPairedMeasurements(measurements);
if (inconclusive.length > 0) {
  console.error('\nInconclusive paired comparisons whose confidence interval crosses 10%:');
  for (const entry of inconclusive) console.error(`- ${key(entry)}`);
}
if (regressions.length > 0) {
  console.error('\nPaired timing regressions above 10%:');
  for (const entry of regressions) {
    console.error(
      `- ${key(entry)}: ${((entry.lowerRatio - 1) * 100).toFixed(1)}%..${((entry.upperRatio - 1) * 100).toFixed(1)}%`,
    );
  }
}

process.exitCode = regressions.length > 0 ? 1 : inconclusive.length > 0 ? 2 : 0;

function key(entry) {
  return `${entry.implementation}/${entry.workload}/${entry.chunking}`;
}

function runComparison(implementation, workload, chunking, sampleCount) {
  const result = spawnSync(
    process.execPath,
    [
      worker,
      resolve(baselineRoot),
      resolve(candidateRoot),
      implementation,
      workload,
      chunking,
      String(sampleCount),
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(result.stderr || `Comparison worker exited ${result.status}`);
  return JSON.parse(result.stdout);
}
