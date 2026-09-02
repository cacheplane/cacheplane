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

/**
 * Returns the stable implementation/workload/chunking key for a Markdown measurement.
 *
 * @param {{ implementation: string, workload: string, chunking: string }} entry Measurement descriptor.
 * @returns {string} Slash-delimited measurement key.
 */
export function markdownMeasurementKey(entry) {
  return `${entry.implementation}/${entry.workload}/${entry.chunking}`;
}

function freezeScenario(implementation, workload, chunking) {
  return Object.freeze({ implementation, workload, chunking });
}
