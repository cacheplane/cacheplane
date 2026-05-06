// SPDX-License-Identifier: MIT
import type {
  StreamState,
  InternalState,
  AstNode,
  MarkdownNode,
  MarkdownDocumentNode,
  MarkdownInlineNode,
  StreamStatus,
  MarkdownNodeType,
  CitationDefinition,
} from './types';

/**
 * Build a tree-shaped MarkdownNode graph from the flat AstNode array.
 * Walks once; allocates one MarkdownNode per AstNode reached from the root.
 */
export function resolve(state: StreamState): MarkdownNode | null {
  if (state.rootId === null) return null;
  const built = new Map<number, MarkdownNode>();
  const root = buildNode(state.nodes, state.rootId, null, null, built) as MarkdownDocumentNode;

  // Populate citations sidecar from the internal registry on the state.
  const citationDefs = (state as InternalState).citationDefs;
  if (citationDefs && citationDefs.size > 0) {
    for (const [refId, def] of citationDefs) {
      const children = def.childAstIds.map((cid, i) => {
        const child = buildNode(state.nodes, cid, null, i, built);
        return child as MarkdownInlineNode;
      });
      root.citations.set(refId, {
        id: def.id,
        index: def.index,
        children,
        status: def.status,
      });
    }
  }

  return root;
}

function buildNode(
  nodes: AstNode[],
  id: number,
  parent: MarkdownNode | null,
  index: number | null,
  cache: Map<number, MarkdownNode>,
): MarkdownNode {
  const cached = cache.get(id);
  if (cached) return cached;

  const ast = nodes[id]!;
  const status: StreamStatus = ast.status;

  let node: MarkdownNode;
  switch (ast.kind) {
    case 'document':
    case 'paragraph':
    case 'heading':
    case 'blockquote':
    case 'list':
    case 'list-item':
    case 'emphasis':
    case 'strong':
    case 'strikethrough':
    case 'link':
    case 'table':
    case 'table-row':
    case 'table-cell': {
      const partial: any = {
        id, type: ast.kind as MarkdownNodeType, status, parent, index, children: [],
      };
      if (ast.kind === 'document') {
        partial.citations = new Map<string, CitationDefinition>();
      }
      if (ast.kind === 'heading') partial.level = ast.level;
      if (ast.kind === 'list') {
        partial.ordered = ast.ordered;
        partial.start = ast.start;
        partial.tight = ast.tight;
        partial.markerCol = ast.markerCol;
        partial.contentCol = ast.contentCol;
      }
      if (ast.kind === 'list-item' && ast.task !== undefined) {
        partial.task = ast.task;
      }
      if (ast.kind === 'link') {
        partial.url = ast.url;
        partial.title = ast.title;
      }
      if (ast.kind === 'table') {
        partial.alignments = ast.alignments;
      }
      if (ast.kind === 'table-row') {
        partial.isHeader = ast.isHeader;
      }
      if (ast.kind === 'table-cell') {
        partial.alignment = ast.alignment;
      }
      cache.set(id, partial);
      const childAstIds = (ast as any).children as number[];
      partial.children = childAstIds.map((cid, i) => buildNode(nodes, cid, partial, i, cache));
      node = partial as MarkdownNode;
      break;
    }
    case 'citation-reference': {
      node = {
        id,
        type: 'citation-reference',
        status,
        parent,
        index: ast.index,   // citation index, NOT sibling position
        refId: ast.refId,
        resolved: ast.resolved,
      };
      break;
    }
    case 'text': {
      node = { id, type: 'text', status, parent, index, text: ast.text };
      break;
    }
    case 'inline-code': {
      node = { id, type: 'inline-code', status, parent, index, text: ast.text };
      break;
    }
    case 'autolink': {
      node = { id, type: 'autolink', status, parent, index, url: ast.url, text: ast.text };
      break;
    }
    case 'image': {
      node = { id, type: 'image', status, parent, index, url: ast.url, title: ast.title, alt: ast.alt };
      break;
    }
    case 'code-block': {
      node = {
        id, type: 'code-block', status, parent, index,
        variant: ast.variant, language: ast.language, text: ast.text,
      };
      break;
    }
    case 'thematic-break': {
      node = { id, type: 'thematic-break', status, parent, index };
      break;
    }
    case 'soft-break': {
      node = { id, type: 'soft-break', status, parent, index };
      break;
    }
    case 'hard-break': {
      node = { id, type: 'hard-break', status, parent, index };
      break;
    }
  }
  cache.set(id, node!);
  return node!;
}
