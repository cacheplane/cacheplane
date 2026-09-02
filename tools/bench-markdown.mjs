// SPDX-License-Identifier: MIT
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  createMarkdownBenchmarkReport,
  markdownMeasurementKey,
  markdownScenarios,
  parseMarkdownBenchmarkOptions,
} from './bench-markdown-lib.mjs';

const options = parseMarkdownBenchmarkOptions(process.argv.slice(2));
const workerPath = fileURLToPath(new URL('./bench-markdown-worker.mjs', import.meta.url));
const measurements = markdownScenarios.map((scenario) => runWorker(scenario));
const report = createMarkdownBenchmarkReport(measurements, options.samples);

if (options.output) {
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
}

printTable(measurements);

function runWorker(scenario) {
  const key = markdownMeasurementKey(scenario);
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
    { encoding: 'utf8' },
  );

  if (worker.error) {
    throw new Error(`Markdown benchmark worker ${key} failed to start: ${worker.error.message}`);
  }
  if (worker.status !== 0) {
    const detail = worker.stderr.trim() || `exited with status ${worker.status}`;
    throw new Error(`Markdown benchmark worker ${key} failed: ${detail}`);
  }

  try {
    return JSON.parse(worker.stdout);
  } catch (error) {
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
