// SPDX-License-Identifier: MIT
//
// Push-style parser API layered on top of the pull-style state machine
// (create / push / finish). The pull machine produces an immutable
// `StreamState` containing a flat array of `AstNode`s keyed by stable
// numeric ids. This module mirrors that AST into the public `MarkdownNode`
// shape (parent/children references, in-place mutation) and turns each
// internal-state transition into a stream of `ParseEvent`s.
//
// Identity preservation: every AstNode id maps to exactly one MarkdownNode
// instance for the lifetime of the parser. Mutating fields (`status`,
// `text`, container `children`) are updated in-place on that instance so
// consumers can hold long-lived references.
//
// Streaming text: the internal state machine buffers line text until a
// newline is received, at which point inline nodes are committed to the AST.
// To surface streaming text growth as `value-updated` events before the line
// is committed, the parser synthesises a virtual `text` node backed by
// `state.lineBuffer`. This synthetic node lives at a stable reference outside
// the normal id→mirror map. It is created on first non-empty buffer, updated
// in place as chunks arrive, and retired (removed from the document children)
// when the line is committed and real AST nodes take its place.

import { createInternal } from './create';
import { pushInternal } from './push';
import { finishInternal } from './finish';
import type {
  AstNode,
  InternalState,
  MarkdownNode,
  MarkdownDocumentNode,
  MarkdownTextNode,
  MarkdownInlineNode,
  MarkdownCitationReferenceNode,
  MarkdownListItemNode,
  MarkdownTableNode,
  MarkdownTableRowNode,
  MarkdownTableCellNode,
  CitationReferenceAstNode,
  ListItemAstNode,
  TableAstNode,
  TableRowAstNode,
  TableCellAstNode,
  StreamStatus,
  ParseEvent,
  PartialMarkdownParser,
  CitationDefinition,
} from './types';

interface NodeSnapshot {
  status: StreamStatus;
  /** For text/inline-code/code-block: text length at last sync. */
  textLen: number;
  /** For containers: number of children at last sync. */
  childrenLen: number;
}

// Sentinel id for the synthetic pending-text node (never collides with real ids
// since real ids are sequential non-negative integers starting at 0).
const PENDING_TEXT_ID = -1;

export function createPartialMarkdownParser(): PartialMarkdownParser {
  let state: InternalState = createInternal();
  const mirror = new Map<number, MarkdownNode>();
  const snap = new Map<number, NodeSnapshot>();

  // Synthetic node that surfaces buffered line text before it is committed.
  let pendingTextNode: MarkdownTextNode | null = null;
  let pendingTextLen = 0;

  // ── Synthetic pending-text helpers ────────────────────────────────────────

  function syncPendingText(events: ParseEvent[]): void {
    const buf = state.lineBuffer;
    if (!buf) {
      // Buffer is empty — retire any existing pending node.
      if (pendingTextNode) {
        pendingTextNode.status = 'complete';
        events.push({ type: 'node-completed', node: pendingTextNode });
        pendingTextNode = null;
        pendingTextLen = 0;
      }
      return;
    }

    if (!pendingTextNode) {
      // Create synthetic node.
      pendingTextNode = {
        id: PENDING_TEXT_ID,
        type: 'text',
        status: 'streaming',
        parent: mirror.get(state.rootId ?? -1) ?? null,
        index: null,
        text: buf,
      } as MarkdownTextNode;
      pendingTextLen = buf.length;
      events.push({ type: 'node-created', node: pendingTextNode });
      return;
    }

    if (buf.length > pendingTextLen) {
      const delta = buf.slice(pendingTextLen);
      pendingTextNode.text = buf;
      pendingTextLen = buf.length;
      events.push({ type: 'value-updated', node: pendingTextNode, delta });
    }
  }

  // ── Mirror sync ───────────────────────────────────────────────────────────

  function syncMirror(): ParseEvent[] {
    const events: ParseEvent[] = [];
    const newIds: number[] = [];

    // Pass 1 — create mirror nodes for any new AST nodes. Do NOT wire
    // children yet; child nodes may not be in the mirror map until later in
    // this same pass.
    for (let i = 0; i < state.nodes.length; i++) {
      const ast = state.nodes[i];
      if (!ast) continue;

      if (!mirror.has(i)) {
        const md = createMirrorNode(ast);
        mirror.set(i, md);
        newIds.push(i);
        snap.set(i, {
          status: ast.status,
          textLen: 'text' in ast ? (ast as any).text.length : 0,
          childrenLen: 'children' in ast ? (ast as any).children.length : 0,
        });
      }
    }

    // Wire parent references for newly created nodes (parents are always
    // created before children in the flat array).
    for (const id of newIds) {
      const ast = state.nodes[id]!;
      const md = mirror.get(id)!;
      if (ast.parentId !== null && ast.parentId >= 0) {
        (md as any).parent = mirror.get(ast.parentId) ?? null;
      }
      events.push({ type: 'node-created', node: md });
    }

    // Pass 2 — diff existing nodes (including those just created, so that
    // any same-push text growth or status transitions are picked up).
    for (let i = 0; i < state.nodes.length; i++) {
      const ast = state.nodes[i];
      if (!ast) continue;
      const md = mirror.get(i);
      if (!md) continue;
      const before = snap.get(i)!;

      const textLen = 'text' in ast ? (ast as any).text.length : 0;
      const childrenLen = 'children' in ast ? (ast as any).children.length : 0;
      const textChanged =
        (ast.kind === 'text' || ast.kind === 'inline-code' || ast.kind === 'code-block') &&
        textLen !== before.textLen;
      const childrenChanged = 'children' in ast && childrenLen !== before.childrenLen;
      const statusChanged = ast.status !== before.status;

      if (textChanged) {
        const delta = (ast as any).text.slice(before.textLen);
        (md as any).text = (ast as any).text;
        events.push({ type: 'value-updated', node: md, delta });
      }

      if (childrenChanged || newIds.includes(i)) {
        // Rebuild children array from the current AST child ids.
        if ('children' in ast) {
          rebuildChildren(md, (ast as any).children as number[]);
        }
      }

      if (statusChanged) {
        md.status = ast.status;
        if (ast.status === 'complete') {
          events.push({ type: 'node-completed', node: md });
        }
      }

      // Sync resolved flag for citation-reference nodes.
      if (md.type === 'citation-reference' && ast.kind === 'citation-reference') {
        const citeMd = md as MarkdownCitationReferenceNode;
        const citeAst = ast as CitationReferenceAstNode;
        if (citeMd.resolved !== citeAst.resolved) {
          citeMd.resolved = citeAst.resolved;
          events.push({ type: 'value-updated', node: citeMd });
        }
      }

      // Sync task field for list-item nodes.
      if (md.type === 'list-item' && ast.kind === 'list-item') {
        const li = md as MarkdownListItemNode;
        const liAst = ast as ListItemAstNode;
        const taskChanged =
          JSON.stringify(li.task) !== JSON.stringify(liAst.task);
        if (taskChanged) {
          if (liAst.task !== undefined) li.task = liAst.task;
          else delete (li as any).task;
          events.push({ type: 'value-updated', node: li });
        }
      }

      snap.set(i, {
        status: ast.status,
        textLen,
        childrenLen,
      });
    }

    // Sync citation defs sidecar onto the document root.
    if (state.rootId !== null) {
      const root = mirror.get(state.rootId) as MarkdownDocumentNode | undefined;
      if (root) {
        for (const [refId, def] of state.citationDefs) {
          const children = def.childAstIds
            .map(cid => mirror.get(cid))
            .filter((n): n is MarkdownInlineNode => n !== undefined);
          const existing = root.citations.get(refId);
          if (
            !existing ||
            existing.index !== def.index ||
            existing.status !== def.status ||
            existing.children.length !== children.length
          ) {
            root.citations.set(refId, {
              id: refId,
              index: def.index,
              children,
              status: def.status,
            });
          }
        }
        // Remove deleted defs (defensive).
        for (const refId of root.citations.keys()) {
          if (!state.citationDefs.has(refId)) root.citations.delete(refId);
        }
      }
    }

    // Sync the synthetic pending-text node (lineBuffer).
    syncPendingText(events);

    return events;
  }

  function rebuildChildren(node: MarkdownNode, childIds: number[]): void {
    const children: MarkdownNode[] = [];
    for (let i = 0; i < childIds.length; i++) {
      const child = mirror.get(childIds[i]!);
      if (child) {
        (child as any).index = i;
        (child as any).parent = node;
        children.push(child);
      }
    }
    (node as any).children = children;
  }

  function createMirrorNode(ast: AstNode): MarkdownNode {
    const base: any = {
      id: ast.id,
      type: ast.kind,
      status: ast.status,
      parent: null,
      index: null,
    };
    switch (ast.kind) {
      case 'document':
        base.children = [];
        base.citations = new Map<string, CitationDefinition>();
        break;
      case 'paragraph':
      case 'heading':
      case 'blockquote':
      case 'list':
      case 'emphasis':
      case 'strong':
      case 'strikethrough':
      case 'link':
        base.children = [];
        break;
      case 'list-item': {
        const liAst = ast as ListItemAstNode;
        base.children = [];
        if (liAst.task !== undefined) base.task = liAst.task;
        break;
      }
      case 'table': {
        const tableAst = ast as TableAstNode;
        base.children = [];
        base.alignments = tableAst.alignments;
        break;
      }
      case 'table-row': {
        const rowAst = ast as TableRowAstNode;
        base.children = [];
        base.isHeader = rowAst.isHeader;
        break;
      }
      case 'table-cell': {
        const cellAst = ast as TableCellAstNode;
        base.children = [];
        base.alignment = cellAst.alignment;
        break;
      }
      case 'citation-reference': {
        const citeAst = ast as CitationReferenceAstNode;
        base.refId = citeAst.refId;
        base.index = citeAst.index;  // citation index (shadows sibling position)
        base.resolved = citeAst.resolved;
        break;
      }
    }
    if (ast.kind === 'heading') base.level = ast.level;
    if (ast.kind === 'list') {
      base.ordered = ast.ordered;
      base.start = ast.start;
      base.tight = ast.tight;
      base.markerCol = ast.markerCol;
      base.contentCol = ast.contentCol;
    }
    if (ast.kind === 'link') {
      base.url = ast.url;
      base.title = ast.title;
    }
    if (ast.kind === 'autolink') {
      base.url = ast.url;
      base.text = ast.text;
    }
    if (ast.kind === 'image') {
      base.url = ast.url;
      base.title = ast.title;
      base.alt = ast.alt;
    }
    if (ast.kind === 'code-block') {
      base.variant = ast.variant;
      base.language = ast.language;
      base.text = ast.text;
    }
    if (ast.kind === 'text' || ast.kind === 'inline-code') {
      base.text = ast.text;
    }
    return base;
  }

  const parser: PartialMarkdownParser = {
    push(chunk: string): ParseEvent[] {
      state = pushInternal(state, chunk);
      return syncMirror();
    },
    finish(): ParseEvent[] {
      state = finishInternal(state);
      return syncMirror();
    },
    get root(): MarkdownDocumentNode | null {
      if (state.rootId === null) return null;
      return (mirror.get(state.rootId) ?? null) as MarkdownDocumentNode | null;
    },
    getByPath(path: string): MarkdownNode | null {
      if (path === '') return parser.root;
      if (!path.startsWith('/')) return null;
      const segments = path.slice(1).split('/').map(unescapePointer);
      let node: any = parser.root;
      let i = 0;
      while (i < segments.length) {
        if (!node) return null;
        const segment = segments[i]!;
        if (segment === 'children' && Array.isArray(node.children)) {
          const next = segments[i + 1];
          if (next == null) return null;
          const idx = parseInt(next, 10);
          if (!Number.isFinite(idx)) return null;
          node = node.children[idx] ?? null;
          i += 2;
          continue;
        }
        return null;
      }
      return node ?? null;
    },
  };
  return parser;
}

function unescapePointer(s: string): string {
  return s.replace(/~1/g, '/').replace(/~0/g, '~');
}
