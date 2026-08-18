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
  LinkDefinition,
} from './types';
import { handleBlockLine } from './handlers/block';

/**
 * Build a tree-shaped MarkdownNode graph from the flat AstNode array.
 * Walks once; allocates one MarkdownNode per AstNode reached from the root.
 */
export function resolve(state: StreamState): MarkdownNode | null {
  const committed = state as InternalState;
  if (committed.rootId === null) return null;
  const source = projectOpenLine(committed);
  const built = new Map<number, MarkdownNode>();
  const root = buildNode(
    source.nodes,
    source.rootId!,
    null,
    null,
    built,
    committed.nodes,
  ) as MarkdownDocumentNode;

  // Populate citations sidecar from the internal registry on the state.
  const citationDefs = source.citationDefs;
  if (citationDefs && citationDefs.size > 0) {
    for (const [refId, def] of citationDefs) {
      const children = def.childAstIds.map((cid, i) => {
        const child = buildNode(
          source.nodes,
          cid,
          null,
          i,
          built,
          committed.nodes,
        );
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

  const linkDefs = source.linkDefs;
  if (linkDefs && linkDefs.size > 0) {
    for (const [refId, def] of linkDefs) {
      root.linkDefinitions.set(refId, {
        id: def.id,
        label: def.label,
        url: def.url,
        title: def.title,
        status: def.status,
      });
    }
  }

  return root;
}

function projectOpenLine(state: InternalState): InternalState {
  const needsPreview =
    !state.complete &&
    (state.lineBuffer.length > 0 || state.tablePending !== null);
  if (!needsPreview) return state;

  return handleBlockLine(
    {
      ...state,
      lineBuffer: '',
      optimisticInline: true,
      optimisticBlock: true,
    },
    state.lineBuffer,
  );
}

function buildNode(
  nodes: AstNode[],
  id: number,
  parent: MarkdownNode | null,
  index: number | null,
  cache: Map<number, MarkdownNode>,
  committedNodes: AstNode[],
): MarkdownNode {
  const cached = cache.get(id);
  if (cached) return cached;

  const ast = nodes[id]!;
  const status: StreamStatus =
    ast !== committedNodes[id] ? 'streaming' : ast.status;

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
        partial.linkDefinitions = new Map<string, LinkDefinition>();
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
      partial.children = childAstIds.map((cid, i) =>
        buildNode(nodes, cid, partial, i, cache, committedNodes),
      );
      node = partial as MarkdownNode;
      break;
    }
    case 'link-reference': {
      const partial: any = {
        id,
        type: 'link-reference',
        status,
        parent,
        index,
        refId: ast.refId,
        label: ast.label,
        form: ast.form,
        resolved: ast.resolved,
        url: ast.url,
        title: ast.title,
        children: [],
      };
      cache.set(id, partial);
      partial.children = ast.children.map((cid, i) =>
        buildNode(nodes, cid, partial, i, cache, committedNodes),
      );
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
    case 'math-inline': {
      node = { id, type: 'math-inline', status, parent, index, text: ast.text, delimiter: ast.delimiter };
      break;
    }
    case 'math-display': {
      node = { id, type: 'math-display', status, parent, index, text: ast.text, delimiter: ast.delimiter };
      break;
    }
    case 'html-inline': {
      node = { id, type: 'html-inline', status, parent, index, raw: ast.raw };
      break;
    }
    case 'html-block': {
      node = { id, type: 'html-block', status, parent, index, raw: ast.raw, htmlKind: ast.htmlKind };
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
