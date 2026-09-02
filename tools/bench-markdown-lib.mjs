// SPDX-License-Identifier: MIT
import {
  median,
  relativeMedianAbsoluteDeviation,
} from './bench-lib.mjs';
import { isDeepStrictEqual } from 'node:util';
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

/** Maximum duration allowed for one paired Markdown comparison worker. */
export const markdownComparisonWorkerTimeoutMs = 3_600_000;

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
const comparisonMeasurementNonnegativeFields = Object.freeze([
  'baselineMedianMs',
  'candidateMedianMs',
  'medianRatio',
  'lowerRatio',
  'upperRatio',
  'ratioRelativeMad',
]);
const comparisonMeasurementPositiveIntegerFields = Object.freeze([
  'samples',
  'repetitions',
  'bytes',
  'chunks',
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
 * Parses the exact positional CLI for paired Markdown worktree comparisons.
 *
 * @param {string[]} args Command-line arguments after the script path.
 * @returns {{ baselineRoot: string, candidateRoot: string, samples: number, output: string | undefined }} Parsed comparison options.
 */
export function parseMarkdownComparisonOptions(args) {
  if (args[0] === '--') {
    throw new Error('Markdown comparison does not accept a leading --');
  }
  if (args.length < 2 || args[0].startsWith('--') || args[1].startsWith('--')) {
    throw new Error('Markdown comparison requires baseline and candidate roots');
  }

  const [baselineRoot, candidateRoot, ...options] = args;
  if (!baselineRoot || !candidateRoot) {
    throw new Error('Markdown comparison requires baseline and candidate roots');
  }

  let samples = 31;
  let output;
  const seen = new Set();
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option !== '--samples' && option !== '--output') {
      throw new Error(`Unknown Markdown comparison option: ${option}`);
    }
    if (seen.has(option)) {
      throw new Error(`Duplicate Markdown comparison option: ${option}`);
    }
    seen.add(option);

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

  if (!Number.isInteger(samples) || samples < 30) {
    throw new Error('--samples must be an integer >= 30');
  }
  return { baselineRoot, candidateRoot, samples, output };
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
 * Parses and validates one paired Markdown comparison worker scenario.
 *
 * @param {string[]} args Worker arguments after the script path.
 * @returns {{ baselineRoot: string, candidateRoot: string, implementation: string, workload: string, chunking: string, samples: number }} Validated worker arguments.
 */
export function parseMarkdownComparisonWorkerArguments(args) {
  if (args.length !== 6) {
    throw new Error('Invalid Markdown comparison worker arguments');
  }

  const [baselineRoot, candidateRoot, implementation, workload, chunking, rawSamples] = args;
  const samples = Number(rawSamples);
  if (!Number.isInteger(samples) || samples < 30) {
    throw new Error('Markdown comparison worker samples must be an integer >= 30');
  }

  const key = markdownMeasurementKey({ implementation, workload, chunking });
  if (!baselineRoot || !candidateRoot || !markdownScenarioKeys.has(key)) {
    throw new Error(`Invalid Markdown comparison worker arguments: ${key}`);
  }
  return {
    baselineRoot,
    candidateRoot,
    implementation,
    workload,
    chunking,
    samples,
  };
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

/**
 * Validates paired Markdown measurements and creates the stable schema-v1 report.
 *
 * @param {object[]} measurements Paired scenario measurements from isolated workers.
 * @param {number} initialSamples Initial timing samples requested from each worker.
 * @returns {{ schemaVersion: 1, runtime: string, platform: string, initialSamples: number, maxRegression: 0.1, measurements: object[] }} Markdown comparison report.
 */
export function createMarkdownComparisonReport(measurements, initialSamples) {
  if (!Number.isInteger(initialSamples) || initialSamples < 30) {
    throw new Error('Markdown comparison report initial samples must be an integer >= 30');
  }

  validateMarkdownMeasurementKeys(measurements, 'comparison report');
  for (const measurement of measurements) {
    validateMeasurementFields(
      measurement,
      comparisonMeasurementNonnegativeFields,
      comparisonMeasurementPositiveIntegerFields,
      'comparison measurement',
    );
  }

  return {
    schemaVersion: 1,
    runtime: process.version,
    platform: `${process.platform}-${process.arch}`,
    initialSamples,
    maxRegression: 0.10,
    measurements,
  };
}

/**
 * Serializes a Markdown comparison report with stable readable formatting.
 *
 * @param {object} report Validated comparison report.
 * @returns {string} Newline-terminated JSON.
 */
export function serializeMarkdownComparisonReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * Classifies paired Markdown measurements against the fixed 10% regression limit.
 *
 * @param {object[]} measurements Paired Markdown measurements.
 * @returns {{ passed: object[], inconclusive: object[], regressions: object[] }} Measurements grouped by final status.
 */
export function classifyMarkdownPairedMeasurements(measurements) {
  const threshold = 1.10;
  return {
    passed: measurements.filter((entry) => entry.upperRatio <= threshold),
    inconclusive: measurements.filter(
      (entry) => entry.lowerRatio <= threshold && entry.upperRatio > threshold,
    ),
    regressions: measurements.filter((entry) => entry.lowerRatio > threshold),
  };
}

/**
 * Selects all paired Markdown measurements that have not passed.
 *
 * @param {object[]} measurements Paired Markdown measurements in report order.
 * @returns {object[]} Non-passing measurements in report order.
 */
export function selectMarkdownComparisonRetries(measurements) {
  return measurements.filter((entry) => entry.upperRatio > 1.10);
}

/**
 * Returns the process exit code for a final Markdown comparison classification.
 *
 * @param {{ regressions: object[], inconclusive: object[] }} classification Final classification.
 * @returns {0 | 1 | 2} Zero for pass, one for regression, or two for inconclusive.
 */
export function markdownComparisonExitCode(classification) {
  if (classification.regressions.length > 0) return 1;
  if (classification.inconclusive.length > 0) return 2;
  return 0;
}

/**
 * Selects the slower robust duration from paired five-run calibrations.
 *
 * @param {number[]} baselineDurations Baseline calibration durations.
 * @param {number[]} candidateDurations Candidate calibration durations.
 * @returns {number} Slower median calibration duration.
 */
export function markdownComparisonCalibrationDuration(
  baselineDurations,
  candidateDurations,
) {
  return Math.max(median(baselineDurations), median(candidateDurations));
}

/**
 * Asserts that baseline and candidate produce deeply equivalent output.
 *
 * @param {unknown} baselineOutput Baseline scenario output.
 * @param {unknown} candidateOutput Candidate scenario output.
 * @param {{ implementation: string, workload: string, chunking: string }} scenario Compared scenario.
 * @returns {void}
 */
export function assertMarkdownComparisonOutputsEquivalent(
  baselineOutput,
  candidateOutput,
  scenario,
) {
  if (!isDeepStrictEqual(baselineOutput, candidateOutput)) {
    throw new Error(
      `Markdown comparison ${markdownMeasurementKey(scenario)} outputs differ between baseline and candidate`,
    );
  }
}

/**
 * Validates equivalent outputs from fresh baseline and candidate scenario runs.
 *
 * @param {() => unknown} baselineRun Fresh baseline benchmark invocation.
 * @param {() => unknown} candidateRun Fresh candidate benchmark invocation.
 * @param {{ implementation: string, workload: string, chunking: string }} scenario Compared scenario.
 * @returns {void}
 */
export function assertMarkdownComparisonRunOutputsEquivalent(
  baselineRun,
  candidateRun,
  scenario,
) {
  const checks = scenario.chunking === 'prepared' && (
    scenario.implementation === 'leaf-change' ||
    scenario.implementation === 'citation-change'
  ) ? 2 : 1;

  for (let index = 0; index < checks; index += 1) {
    assertMarkdownComparisonOutputsEquivalent(
      baselineRun(),
      candidateRun(),
      scenario,
    );
  }
}

/**
 * Converts an unsuccessful paired worker result into a scenario-specific error.
 *
 * @param {{ error?: Error & { code?: string }, status: number | null, signal?: string | null, stderr?: string }} worker Worker process result.
 * @param {{ implementation: string, workload: string, chunking: string }} scenario Worker scenario.
 * @returns {Error | null} Worker failure, or null for a successful exit.
 */
export function markdownComparisonWorkerError(worker, scenario) {
  const key = markdownMeasurementKey(scenario);
  if (worker.error?.code === 'ETIMEDOUT') {
    return new Error(
      `Markdown comparison worker ${key} timed out after ${markdownComparisonWorkerTimeoutMs}ms`,
    );
  }
  if (worker.error) {
    return new Error(
      `Markdown comparison worker ${key} failed to start: ${worker.error.message}`,
    );
  }
  if (worker.status !== 0) {
    const detail = worker.stderr?.trim() || (
      worker.signal ? `terminated by signal ${worker.signal}` : `exited with status ${worker.status}`
    );
    return new Error(`Markdown comparison worker ${key} failed: ${detail}`);
  }
  return null;
}

function validateMarkdownMeasurementKeys(measurements, reportName) {
  const keys = measurements.map(markdownMeasurementKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error(`Markdown ${reportName} contains duplicate measurement keys`);
  }
  if (
    keys.length !== markdownScenarios.length ||
    keys.some((key) => !markdownScenarioKeys.has(key))
  ) {
    throw new Error(`Markdown ${reportName} measurement keys do not match expected scenarios`);
  }
}

function validateMeasurementFields(measurement, nonnegativeFields, positiveIntegerFields, label) {
  for (const field of nonnegativeFields) {
    if (!Number.isFinite(measurement[field]) || measurement[field] < 0) {
      throw new Error(
        `Markdown ${label} ${markdownMeasurementKey(measurement)} has invalid ${field}`,
      );
    }
  }
  for (const field of positiveIntegerFields) {
    if (!Number.isInteger(measurement[field]) || measurement[field] <= 0) {
      throw new Error(
        `Markdown ${label} ${markdownMeasurementKey(measurement)} has invalid ${field}`,
      );
    }
  }
}

function freezeScenario(implementation, workload, chunking) {
  return Object.freeze({ implementation, workload, chunking });
}
