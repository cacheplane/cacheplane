// SPDX-License-Identifier: MIT
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  compareReports,
  comparisonExitCode,
  measurementKey,
  parseOptions,
} from './bench-json-lib.mjs';
import { jsonChunkers, jsonWorkloads } from './fixtures/json-workloads.mjs';

const options = parseOptions(process.argv.slice(2));
const measurements = [];
const workerPath = fileURLToPath(new URL('./bench-json-worker.mjs', import.meta.url));
const implementations = [
  'json-stream',
  'partial-json-events',
  'partial-json-final-materialize',
  'partial-json-materialize-each',
];

for (const workload of jsonWorkloads) {
  for (const chunker of jsonChunkers) {
    for (const implementation of implementations) {
      const worker = spawnSync(
        process.execPath,
        ['--expose-gc', workerPath, implementation, workload.name, chunker.name, String(options.samples)],
        { encoding: 'utf8' },
      );
      if (worker.status !== 0) throw new Error(worker.stderr || `Benchmark worker exited ${worker.status}`);
      measurements.push(JSON.parse(worker.stdout));
    }
  }
}

const report = {
  schemaVersion: 2,
  runtime: process.version,
  platform: `${process.platform}-${process.arch}`,
  samples: options.samples,
  measurements,
};

if (options.output) await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);

printTable(measurements);

if (options.baseline) {
  const baseline = JSON.parse(await readFile(options.baseline, 'utf8'));
  const comparison = compareReports(baseline, report);
  if (comparison.skipped.length > 0) {
    console.warn('\nMeasurements below a reliable comparison floor:');
    for (const result of comparison.skipped) console.warn(`- ${result}`);
  }
  if (comparison.inconclusive.length > 0) {
    console.warn('\nInconclusive high-variance comparisons:');
    for (const result of comparison.inconclusive) console.warn(`- ${result}`);
  }
  if (comparison.regressions.length > 0) {
    console.error('\nRegressions above the 10% time or 15% retained-heap limits:');
    for (const regression of comparison.regressions) console.error(`- ${regression}`);
  }
  process.exitCode = comparisonExitCode(comparison);
}

function printTable(entries) {
  const rows = entries.map((entry) => ({
    implementation: entry.implementation,
    workload: entry.workload,
    chunking: entry.chunking,
    chunks: entry.chunks,
    repetitions: entry.repetitions,
    medianMs: entry.medianMs.toFixed(2),
    relativeMad: `${(entry.relativeMad * 100).toFixed(1)}%`,
    retainedKiB: (entry.retainedHeapBytes / 1024).toFixed(0),
    retainedMad: `${(entry.retainedHeapRelativeMad * 100).toFixed(1)}%`,
  }));
  console.table(rows);
}
