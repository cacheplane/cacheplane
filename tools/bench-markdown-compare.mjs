// SPDX-License-Identifier: MIT
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextPairedSampleCount } from './bench-lib.mjs';
import {
  classifyMarkdownPairedMeasurements,
  createMarkdownComparisonReport,
  markdownComparisonExitCode,
  markdownComparisonWorkerError,
  markdownComparisonWorkerTimeoutMs,
  markdownMeasurementKey,
  markdownScenarios,
  parseMarkdownComparisonOptions,
  selectMarkdownComparisonRetries,
  serializeMarkdownComparisonReport,
} from './bench-markdown-lib.mjs';

const options = parseMarkdownComparisonOptions(process.argv.slice(2));
const baselineRoot = resolve(options.baselineRoot);
const candidateRoot = resolve(options.candidateRoot);
const workerPath = fileURLToPath(
  new URL('./bench-markdown-compare-worker.mjs', import.meta.url),
);
const measurements = [];

for (const [index, scenario] of markdownScenarios.entries()) {
  measurements.push(runWorker(scenario, options.samples));
  printProgress('initial', index + 1, markdownScenarios.length, scenario, options.samples);
}

let retrySamples = nextPairedSampleCount(options.samples);
let retries = selectMarkdownComparisonRetries(measurements);
while (retries.length > 0 && retrySamples !== null) {
  console.error(
    `Retrying ${retries.length} non-passing Markdown comparisons with ${retrySamples} paired samples`,
  );
  for (const [index, scenario] of retries.entries()) {
    const measurementIndex = measurements.findIndex(
      (entry) => markdownMeasurementKey(entry) === markdownMeasurementKey(scenario),
    );
    measurements[measurementIndex] = runWorker(scenario, retrySamples);
    printProgress('retry', index + 1, retries.length, scenario, retrySamples);
  }
  retries = selectMarkdownComparisonRetries(measurements);
  retrySamples = nextPairedSampleCount(retrySamples);
}

const report = createMarkdownComparisonReport(measurements, options.samples);
if (options.output) {
  await writeFile(options.output, serializeMarkdownComparisonReport(report));
}

printTable(measurements);
const classification = classifyMarkdownPairedMeasurements(measurements);
printFinalClassification(classification);
process.exitCode = markdownComparisonExitCode(classification);

function runWorker(scenario, samples) {
  const worker = spawnSync(
    process.execPath,
    [
      workerPath,
      baselineRoot,
      candidateRoot,
      scenario.implementation,
      scenario.workload,
      scenario.chunking,
      String(samples),
    ],
    {
      encoding: 'utf8',
      timeout: markdownComparisonWorkerTimeoutMs,
    },
  );

  const workerError = markdownComparisonWorkerError(worker, scenario);
  if (workerError) throw workerError;

  try {
    return JSON.parse(worker.stdout);
  } catch (error) {
    const key = markdownMeasurementKey(scenario);
    throw new Error(
      `Markdown comparison worker ${key} returned invalid JSON: ${error.message}`,
    );
  }
}

function printProgress(kind, index, total, scenario, samples) {
  console.error(
    `[${kind} ${index}/${total}] ${markdownMeasurementKey(scenario)} (${samples} paired samples)`,
  );
}

function printTable(entries) {
  console.table(entries.map((entry) => ({
    implementation: entry.implementation,
    workload: entry.workload,
    chunking: entry.chunking,
    samples: entry.samples,
    baselineMs: entry.baselineMedianMs.toFixed(2),
    candidateMs: entry.candidateMedianMs.toFixed(2),
    change: `${((entry.medianRatio - 1) * 100).toFixed(1)}%`,
    interval: `${((entry.lowerRatio - 1) * 100).toFixed(1)}%..${((entry.upperRatio - 1) * 100).toFixed(1)}%`,
    ratioMad: `${(entry.ratioRelativeMad * 100).toFixed(1)}%`,
  })));
}

function printFinalClassification({ regressions, inconclusive }) {
  if (regressions.length > 0) {
    console.error('\nConfirmed Markdown timing regressions above 10%:');
    for (const entry of regressions) {
      console.error(
        `- ${markdownMeasurementKey(entry)}: ${formatInterval(entry)}`,
      );
    }
  }
  if (inconclusive.length > 0) {
    console.error('\nInconclusive Markdown timing comparisons crossing 10%:');
    for (const entry of inconclusive) {
      console.error(
        `- ${markdownMeasurementKey(entry)}: ${formatInterval(entry)}`,
      );
    }
  }
  if (regressions.length === 0 && inconclusive.length === 0) {
    console.error('\nAll Markdown timing comparisons passed the 10% regression limit.');
  }
}

function formatInterval(entry) {
  return `${((entry.lowerRatio - 1) * 100).toFixed(1)}%..${((entry.upperRatio - 1) * 100).toFixed(1)}%`;
}
