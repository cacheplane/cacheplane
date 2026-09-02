// SPDX-License-Identifier: MIT
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  createMarkdownBenchmarkReport,
  formatMarkdownBenchmarkProgress,
  markdownBenchmarkWorkerError,
  markdownBenchmarkWorkerTimeoutMs,
  markdownMeasurementKey,
  markdownScenarios,
  parseMarkdownBenchmarkOptions,
} from './bench-markdown-lib.mjs';

const options = parseMarkdownBenchmarkOptions(process.argv.slice(2));
const workerPath = fileURLToPath(new URL('./bench-markdown-worker.mjs', import.meta.url));
const measurements = [];
for (const [index, scenario] of markdownScenarios.entries()) {
  measurements.push(runWorker(scenario));
  console.error(formatMarkdownBenchmarkProgress(index + 1, markdownScenarios.length, scenario));
}
const report = createMarkdownBenchmarkReport(measurements, options.samples);

if (options.output) {
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
}

printTable(measurements);

function runWorker(scenario) {
  const worker = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      workerPath,
      scenario.implementation,
      scenario.workload,
      scenario.chunking,
      String(options.samples),
    ],
    { encoding: 'utf8', timeout: markdownBenchmarkWorkerTimeoutMs },
  );

  const workerError = markdownBenchmarkWorkerError(worker, scenario);
  if (workerError) throw workerError;

  try {
    return JSON.parse(worker.stdout);
  } catch (error) {
    const key = markdownMeasurementKey(scenario);
    throw new Error(`Markdown benchmark worker ${key} returned invalid JSON: ${error.message}`);
  }
}

function printTable(entries) {
  const rows = entries.map((entry) => ({
    implementation: entry.implementation,
    workload: entry.workload,
    chunking: entry.chunking,
    bytes: entry.bytes,
    chunks: entry.chunks,
    repetitions: entry.repetitions,
    medianMs: entry.medianMs.toFixed(2),
    relativeMad: `${(entry.relativeMad * 100).toFixed(1)}%`,
    retainedKiB: (entry.retainedHeapBytes / 1024).toFixed(0),
    retainedMad: `${(entry.retainedHeapRelativeMad * 100).toFixed(1)}%`,
  }));
  console.table(rows);
}
