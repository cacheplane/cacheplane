export function chunksAt(input: string, cuts: number[]): string[] {
  const chunks: string[] = [];
  let previous = 0;

  for (const cut of cuts) {
    if (cut <= previous || cut >= input.length) continue;
    chunks.push(input.slice(previous, cut));
    previous = cut;
  }

  chunks.push(input.slice(previous));
  return chunks.filter((chunk) => chunk.length > 0);
}

export function oneCharChunks(input: string): string[] {
  return Array.from(input);
}

export function representativePartitions(input: string): string[][] {
  const middle = Math.floor(input.length / 2);

  return [
    [input],
    oneCharChunks(input),
    chunksAt(input, [1]),
    chunksAt(input, [middle]),
    chunksAt(input, [input.length - 1]),
  ];
}
