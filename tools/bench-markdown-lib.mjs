// SPDX-License-Identifier: MIT
import {
  markdownChunkers,
  markdownWorkloads,
} from './fixtures/markdown-workloads.mjs';

const sourceImplementations = Object.freeze([
  'events',
  'final-materialize',
  'materialize-each',
]);

const sourceScenarios = sourceImplementations.flatMap((implementation) => (
  markdownWorkloads.flatMap((workload) => (
    markdownChunkers.map((chunker) => freezeScenario(
      implementation,
      workload.name,
      chunker.name,
    ))
  ))
));

const preparedScenarios = [
  freezeScenario('unchanged', 'long-prose', 'prepared'),
  freezeScenario('leaf-change', 'long-prose', 'prepared'),
  freezeScenario('citation-change', 'references', 'prepared'),
];

export const markdownScenarios = Object.freeze([
  ...sourceScenarios,
  ...preparedScenarios,
]);

const markdownScenarioKeys = new Set(markdownScenarios.map(markdownMeasurementKey));
const measurementNumericFields = Object.freeze([
  'medianMs',
  'relativeMad',
  'retainedHeapBytes',
  'retainedHeapRelativeMad',
  'bytes',
  'chunks',
  'repetitions',
]);

/**
 * Returns the stable implementation/workload/chunking key for a Markdown measurement.
 *
 * @param {{ implementation: string, workload: string, chunking: string }} entry Measurement descriptor.
 * @returns {string} Slash-delimited measurement key.
 */
export function markdownMeasurementKey(entry) {
  return `${entry.implementation}/${entry.workload}/${entry.chunking}`;
}

/**
 * Parses command-line options for the Markdown benchmark orchestrator.
 *
 * @param {string[]} args Command-line arguments after the script path.
 * @returns {{ samples: number, output: string | undefined }} Parsed benchmark options.
 */
export function parseMarkdownBenchmarkOptions(args) {
  let samples = 31;
  let output;
  const options = args[0] === '--' ? args.slice(1) : args;

  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option !== '--samples' && option !== '--output') {
      throw new Error(`Unknown Markdown benchmark option: ${option}`);
    }

    const value = options[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${option} requires an option value`);
    }
    index += 1;

    if (option === '--samples') {
      samples = Number(value);
    } else {
      output = value;
    }
  }

  if (!Number.isInteger(samples) || samples < 3) {
    throw new Error('--samples must be an integer >= 3');
  }
  return { samples, output };
}

/**
 * Parses and validates a Markdown benchmark worker scenario.
 *
 * @param {string[]} args Worker arguments after the script path.
 * @returns {{ implementation: string, workload: string, chunking: string, samples: number }} Validated worker arguments.
 */
export function parseMarkdownWorkerArguments(args) {
  if (args.length !== 4) throw new Error('Invalid Markdown benchmark worker arguments');

  const [implementation, workload, chunking, rawSamples] = args;
  const samples = Number(rawSamples);
  if (!Number.isInteger(samples) || samples < 3) {
    throw new Error('Markdown benchmark worker samples must be an integer >= 3');
  }

  const key = markdownMeasurementKey({ implementation, workload, chunking });
  if (!markdownScenarioKeys.has(key)) {
    throw new Error(`Invalid Markdown benchmark worker arguments: ${key}`);
  }
  return { implementation, workload, chunking, samples };
}

/**
 * Validates Markdown measurements and creates the stable schema-v1 report.
 *
 * @param {object[]} measurements Scenario measurements from isolated workers.
 * @param {number} samples Timing samples requested from each worker.
 * @returns {{ schemaVersion: 1, runtime: string, platform: string, samples: number, measurements: object[] }} Markdown benchmark report.
 */
export function createMarkdownBenchmarkReport(measurements, samples) {
  const keys = measurements.map(markdownMeasurementKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error('Markdown benchmark report contains duplicate measurement keys');
  }
  if (
    keys.length !== markdownScenarios.length ||
    keys.some((key) => !markdownScenarioKeys.has(key))
  ) {
    throw new Error('Markdown benchmark report measurement keys do not match expected scenarios');
  }

  for (const measurement of measurements) {
    for (const field of measurementNumericFields) {
      if (!Number.isFinite(measurement[field]) || measurement[field] < 0) {
        throw new Error(
          `Markdown benchmark measurement ${markdownMeasurementKey(measurement)} has invalid ${field}`,
        );
      }
    }
  }

  return {
    schemaVersion: 1,
    runtime: process.version,
    platform: `${process.platform}-${process.arch}`,
    samples,
    measurements,
  };
}

function freezeScenario(implementation, workload, chunking) {
  return Object.freeze({ implementation, workload, chunking });
}
