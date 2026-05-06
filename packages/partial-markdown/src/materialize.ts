// SPDX-License-Identifier: MIT
import type { MarkdownNode } from './types';


interface CacheEntry {
  version: string;
  value: unknown;
}

const cache = new WeakMap<MarkdownNode, CacheEntry>();

/**
 * Produce a structurally-shared, plain-object snapshot of a markdown node tree.
 * Subtrees that haven't changed since the last call return the same reference.
 *
 * Implemented via a WeakMap keyed by node identity, with a per-node version
 * fingerprint that captures all mutable fields. Same approach used by
 * @cacheplane/partial-json's materialize().
 */
export function materialize(node: MarkdownNode | null): unknown {
  if (node === null) return null;
  const version = computeVersion(node);
  const entry = cache.get(node);
  if (entry && entry.version === version) return entry.value;
  const value = materializeNode(node);
  cache.set(node, { version, value });
  return value;
}

function computeVersion(node: MarkdownNode): string {
  switch (node.type) {
    case 'text':
    case 'inline-code':
      return `${node.type}:${node.status}:${(node as any).text}`;
    case 'code-block':
      return `code-block:${node.status}:${(node as any).language}:${(node as any).text}`;
    case 'autolink':
      return `autolink:${node.status}:${(node as any).url}`;
    case 'image':
      return `image:${(node as any).url}:${(node as any).alt}:${(node as any).title}`;
    case 'thematic-break':
    case 'soft-break':
    case 'hard-break':
      return `${node.type}:${node.status}`;
    case 'citation-reference':
      return `citation-reference:${node.status}:${(node as any).refId}:${(node as any).resolved}:${(node as any).index}`;
    default: {
      const parts = [`${node.type}:${node.status}`];
      const children = (node as any).children as MarkdownNode[] | undefined;
      if (children) {
        for (const child of children) parts.push(computeVersion(child));
      }
      if (node.type === 'heading') parts.push(`L${(node as any).level}`);
      if (node.type === 'list') parts.push(`O${(node as any).ordered}:S${(node as any).start}:T${(node as any).tight}`);
      if (node.type === 'list-item' && (node as any).task !== undefined) {
        parts.push(`TASK:${(node as any).task.checked}`);
      }
      if (node.type === 'link') parts.push(`U${(node as any).url}:T${(node as any).title}`);
      if (node.type === 'table') parts.push(`A${JSON.stringify((node as any).alignments)}`);
      if (node.type === 'table-row') parts.push(`H${(node as any).isHeader}`);
      if (node.type === 'table-cell') parts.push(`A${(node as any).alignment}`);
      if (node.type === 'document') {
        const citations = (node as any).citations as Map<string, any> | undefined;
        if (citations) {
          for (const [id, def] of citations) {
            parts.push(`CITE:${id}:${def.index}:${def.status}`);
            for (const child of def.children) parts.push(computeVersion(child));
          }
        }
      }
      return parts.join('|');
    }
  }
}

function materializeNode(node: MarkdownNode): unknown {
  const out: any = { ...node, parent: null };
  const children = (node as any).children as MarkdownNode[] | undefined;
  if (children) {
    out.children = children.map(child => materialize(child));
  }
  if (node.type === 'document') {
    const citations = (node as any).citations as Map<string, any> | undefined;
    if (citations) {
      const newMap = new Map<string, any>();
      for (const [id, def] of citations) {
        newMap.set(id, {
          ...def,
          children: def.children.map((c: MarkdownNode) => materialize(c)),
        });
      }
      out.citations = newMap;
    }
  }
  return out;
}
