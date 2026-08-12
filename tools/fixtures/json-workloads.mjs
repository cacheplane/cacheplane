// SPDX-License-Identifier: MIT

const wide = Object.fromEntries(
  Array.from({ length: 500 }, (_, index) => [`property-${index}`, { index, active: index % 2 === 0 }]),
);

let deep = { value: 'leaf' };
for (let depth = 0; depth < 100; depth += 1) deep = { child: deep };

const generativeUi = {
  type: 'dashboard',
  props: { title: 'Quarterly operations', density: 'compact' },
  children: Array.from({ length: 100 }, (_, index) => ({
    type: index % 5 === 0 ? 'chart' : 'metric',
    props: {
      id: `metric-${index}`,
      label: `Metric ${index}`,
      value: index * 17.25,
      trend: index % 3 === 0 ? 'up' : 'flat',
    },
  })),
};

export const jsonWorkloads = Object.freeze([
  Object.freeze({ name: 'small', input: JSON.stringify({ ok: true, count: 42, labels: ['a', 'b'] }) }),
  Object.freeze({ name: 'wide', input: JSON.stringify(wide) }),
  Object.freeze({ name: 'deep', input: JSON.stringify(deep) }),
  Object.freeze({ name: 'long-string', input: JSON.stringify({ content: 'x'.repeat(64 * 1024) }) }),
  Object.freeze({ name: 'generative-ui', input: JSON.stringify(generativeUi) }),
]);

export const jsonChunkers = Object.freeze([
  Object.freeze({ name: 'whole', split: (input) => [input] }),
  Object.freeze({ name: '64-byte', split: (input) => splitEvery(input, 64) }),
  Object.freeze({ name: 'character', maxInputLength: 4_096, split: (input) => Array.from(input) }),
]);

export function chunksForJsonWorkload(workload, chunker) {
  const input = chunker.maxInputLength === undefined
    ? workload.input
    : workload.input.slice(0, chunker.maxInputLength);
  return { input, chunks: chunker.split(input) };
}

function splitEvery(input, size) {
  const chunks = [];
  for (let offset = 0; offset < input.length; offset += size) chunks.push(input.slice(offset, offset + size));
  return chunks;
}
