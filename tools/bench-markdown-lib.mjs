// SPDX-License-Identifier: MIT
import {
  median,
  relativeMedianAbsoluteDeviation,
} from './bench-lib.mjs';
import {
  markdownChunkers,
  markdownWorkloads,
} from './fixtures/markdown-workloads.mjs';

const sourceImplementations = Object.freeze([
  'events',
  'final-materialize',
  'materialize-each',
]);

const sourceScenarios = markdownWorkloads.flatMap((workload) => (
  markdownChunkers.flatMap((chunker) => (
    sourceImplementations.map((implementation) => freezeScenario(
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

/** Maximum duration allowed for one isolated Markdown benchmark worker. */
export const markdownBenchmarkWorkerTimeoutMs = 300_000;

const markdownScenarioKeys = new Set(markdownScenarios.map(markdownMeasurementKey));
const measurementNonnegativeFields = Object.freeze([
  'medianMs',
  'relativeMad',
  'retainedHeapBytes',
  'retainedHeapRelativeMad',
]);
const measurementPositiveIntegerFields = Object.freeze([
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
 * Formats one completed Markdown benchmark scenario for stderr progress.
 *
 * @param {number} index One-based completed scenario index.
 * @param {number} total Total scenario count.
 * @param {{ implementation: string, workload: string, chunking: string }} scenario Completed scenario.
 * @returns {string} Human-readable progress line.
 */
export function formatMarkdownBenchmarkProgress(index, total, scenario) {
  return `[${index}/${total}] ${markdownMeasurementKey(scenario)}`;
}

/**
 * Converts an unsuccessful worker result into a scenario-specific error.
 *
 * @param {{ error?: Error & { code?: string }, status: number | null, signal?: string | null, stderr?: string }} worker Worker process result.
 * @param {{ implementation: string, workload: string, chunking: string }} scenario Worker scenario.
 * @returns {Error | null} Worker failure, or null for a successful exit.
 */
export function markdownBenchmarkWorkerError(worker, scenario) {
  const key = markdownMeasurementKey(scenario);
  if (worker.error?.code === 'ETIMEDOUT') {
    return new Error(
      `Markdown benchmark worker ${key} timed out after ${markdownBenchmarkWorkerTimeoutMs}ms`,
    );
  }
  if (worker.error) {
    return new Error(`Markdown benchmark worker ${key} failed to start: ${worker.error.message}`);
  }
  if (worker.status !== 0) {
    const detail = worker.stderr?.trim() || (
      worker.signal ? `terminated by signal ${worker.signal}` : `exited with status ${worker.status}`
    );
    return new Error(`Markdown benchmark worker ${key} failed: ${detail}`);
  }
  return null;
}

/**
 * Computes retained-heap dispersion without hiding sparse positive samples.
 *
 * @param {number[]} samples Retained-heap byte samples.
 * @returns {number} Relative retained-heap instability.
 */
export function markdownRetainedHeapRelativeMad(samples) {
  if (median(samples) === 0 && samples.some((sample) => sample > 0)) return 1;
  return relativeMedianAbsoluteDeviation(samples);
}

/**
 * Measures one retained-heap sample with the scenario's consumer retention model.
 *
 * @param {() => unknown} run Benchmark invocation.
 * @param {{
 *   retainPrevious: boolean,
 *   collectGarbage: () => void,
 *   heapUsed: () => number,
 *   retain: (value: unknown) => void,
 * }} environment Heap measurement operations.
 * @returns {number} Nonnegative retained-heap bytes.
 */
export function measureMarkdownRetainedHeapSample(run, environment) {
  let retainedSnapshots;
  if (environment.retainPrevious) {
    retainedSnapshots = { previous: run(), current: undefined };
    environment.retain(retainedSnapshots);
  }

  environment.collectGarbage();
  const before = environment.heapUsed();
  if (retainedSnapshots) {
    retainedSnapshots.current = run();
  } else {
    environment.retain(run());
  }
  environment.collectGarbage();
  return Math.max(0, environment.heapUsed() - before);
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
  if (!Number.isInteger(samples) || samples < 3) {
    throw new Error('Markdown benchmark report samples must be an integer >= 3');
  }

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
    for (const field of measurementNonnegativeFields) {
      if (!Number.isFinite(measurement[field]) || measurement[field] < 0) {
        throw new Error(
          `Markdown benchmark measurement ${markdownMeasurementKey(measurement)} has invalid ${field}`,
        );
      }
    }
    for (const field of measurementPositiveIntegerFields) {
      if (!Number.isInteger(measurement[field]) || measurement[field] <= 0) {
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
