// SPDX-License-Identifier: MIT
import { createPartialMarkdownParser } from '../../index';
import type { MarkdownNode } from '../../index';

const SCALARS = ['variant', 'language', 'meta', 'text', 'url', 'title', 'alt'] as const;

/** Structural projection of a public node: type, key scalars, children. */
export function shape(node: MarkdownNode | null | undefined): unknown {
  if (!node) return null;
  const out: Record<string, unknown> = { type: node.type };
  for (const key of SCALARS) {
    if (key in node) out[key] = (node as unknown as Record<string, unknown>)[key];
  }
  const kids = (node as { children?: MarkdownNode[] }).children;
  if (kids) out['children'] = kids.map(shape);
  return out;
}

/** Push each chunk, finish, and return the shaped document children. */
export function parseChunks(chunks: readonly string[]): unknown {
  const p = createPartialMarkdownParser();
  for (const chunk of chunks) p.push(chunk);
  p.finish();
  return (shape(p.root) as { children: unknown[] }).children;
}

/** Push each chunk without finishing; return shaped children after each push. */
export function streamSnapshots(chunks: readonly string[]): unknown[] {
  const p = createPartialMarkdownParser();
  return chunks.map((chunk) => {
    p.push(chunk);
    return (shape(p.root) as { children: unknown[] } | null)?.children ?? [];
  });
}
