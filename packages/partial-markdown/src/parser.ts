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
import { handleBlockLine } from './handlers/block';
import type {
  AstNode,
  InternalState,
  MarkdownNode,
  MarkdownDocumentNode,
  MarkdownTextNode,
  MarkdownInlineNode,
  MarkdownCitationReferenceNode,
  MarkdownLinkReferenceNode,
  MarkdownListItemNode,
  MarkdownTableNode,
  MarkdownTableRowNode,
  MarkdownTableCellNode,
  CitationReferenceAstNode,
  LinkReferenceAstNode,
  ListItemAstNode,
  TableAstNode,
  TableRowAstNode,
  TableCellAstNode,
  StreamStatus,
  ParseEvent,
  PartialMarkdownParser,
  PartialMarkdownParserOptions,
  CitationDefinition,
  LinkDefinition,
} from './types';

interface NodeSnapshot {
  status: StreamStatus;
  /** For text-bearing leaves: text length at last sync. */
  textLen: number;
  /** For containers: number of children at last sync. */
  childrenLen: number;
}

// Sentinel id for the synthetic pending-text node (never collides with real ids
// since real ids are sequential non-negative integers starting at 0).
const PENDING_TEXT_ID = -1;

export function createPartialMarkdownParser(options?: PartialMarkdownParserOptions): PartialMarkdownParser {
  let state: InternalState = createInternal(options);
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
          textLen: contentLength(ast),
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

      const textLen = contentLength(ast);
      const childrenLen = 'children' in ast ? (ast as any).children.length : 0;
      const textChanged =
        (
          ast.kind === 'text' ||
          ast.kind === 'inline-code' ||
          ast.kind === 'code-block' ||
          ast.kind === 'math-inline' ||
          ast.kind === 'math-display' ||
          ast.kind === 'html-inline' ||
          ast.kind === 'html-block'
        ) &&
        textLen !== before.textLen;
      const childrenChanged = 'children' in ast && childrenLen !== before.childrenLen;
      const statusChanged = ast.status !== before.status;

      if (textChanged) {
        const value = 'text' in ast ? (ast as any).text : (ast as any).raw;
        const delta = value.slice(before.textLen);
        if ('text' in ast) (md as any).text = value;
        else (md as any).raw = value;
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

      // Sync resolved target fields for link-reference nodes.
      if (md.type === 'link-reference' && ast.kind === 'link-reference') {
        const linkMd = md as MarkdownLinkReferenceNode;
        const linkAst = ast as LinkReferenceAstNode;
        let changed = false;
        if (linkMd.resolved !== linkAst.resolved) {
          linkMd.resolved = linkAst.resolved;
          changed = true;
        }
        if (linkMd.url !== linkAst.url) {
          linkMd.url = linkAst.url;
          changed = true;
        }
        if (linkMd.title !== linkAst.title) {
          linkMd.title = linkAst.title;
          changed = true;
        }
        if (linkMd.status !== linkAst.status) {
          linkMd.status = linkAst.status;
          changed = true;
        }
        if (changed) events.push({ type: 'value-updated', node: linkMd });
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

        for (const [refId, def] of state.linkDefs) {
          const existing = root.linkDefinitions.get(refId);
          if (existing) {
            existing.url = def.url;
            existing.title = def.title;
            existing.status = def.status;
          } else {
            root.linkDefinitions.set(refId, {
              id: def.id,
              label: def.label,
              url: def.url,
              title: def.title,
              status: def.status,
            });
          }
        }
        for (const refId of root.linkDefinitions.keys()) {
          if (!state.linkDefs.has(refId)) root.linkDefinitions.delete(refId);
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
        base.linkDefinitions = new Map<string, LinkDefinition>();
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
      case 'link-reference': {
        const refAst = ast as LinkReferenceAstNode;
        base.refId = refAst.refId;
        base.label = refAst.label;
        base.form = refAst.form;
        base.resolved = refAst.resolved;
        base.url = refAst.url;
        base.title = refAst.title;
        base.children = [];
        break;
      }
      case 'math-inline':
      case 'math-display':
        base.text = ast.text;
        base.delimiter = ast.delimiter;
        break;
      case 'html-inline':
        base.raw = ast.raw;
        break;
      case 'html-block':
        base.raw = ast.raw;
        base.htmlKind = ast.htmlKind;
        break;
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

  // ── Streaming open-line projection (B.2) ──────────────────────────────────
  // Build a fresh MarkdownNode subtree from a preview AST node, marked
  // `streaming`. Used only for the open (unterminated) line, which changes
  // every push — so these nodes are intentionally rebuilt rather than mirrored.
  function astToStreamingNode(id: number, nodes: readonly (AstNode | undefined)[]): MarkdownNode {
    const ast = nodes[id]!;
    const md = createMirrorNode(ast);
    (md as any).status = 'streaming';
    const kids = (ast as any).children;
    if (Array.isArray(kids)) {
      (md as any).children = kids.map((cid: number, i: number) => {
        const c = astToStreamingNode(cid, nodes);
        (c as any).index = i;
        (c as any).parent = md;
        return c;
      });
    }
    return md;
  }

  // Project the committed document with the open `lineBuffer` parsed and grafted
  // on. Runs the block handler on an immutable COPY (committed state + mirror are
  // never touched); committed blocks (same AST object in the preview) reuse their
  // mirror nodes so their identity is preserved across pushes.
  function buildStreamingRoot(committedDoc: MarkdownDocumentNode): MarkdownDocumentNode {
    const preview = handleBlockLine(
      { ...state, lineBuffer: '', optimisticInline: true },
      state.lineBuffer,
    );
    if (preview.rootId === null) return committedDoc;
    const prevDoc = preview.nodes[preview.rootId] as any;
    const childIds: number[] = prevDoc?.children ?? [];
    const children: MarkdownNode[] = childIds.map((cid, i) => {
      if (preview.nodes[cid] === state.nodes[cid] && mirror.has(cid)) {
        return mirror.get(cid)!; // unchanged committed block — reuse (identity)
      }
      const node = astToStreamingNode(cid, preview.nodes);
      (node as any).index = i;
      return node;
    });
    return { ...(committedDoc as any), children } as MarkdownDocumentNode;
  }

  // Memoized streaming projection — rebuilt once per push, so repeated `root` /
  // getByPath reads within one state return the SAME object.
  let openLineRoot: MarkdownDocumentNode | null = null;

  const parser: PartialMarkdownParser = {
    push(chunk: string): ParseEvent[] {
      openLineRoot = null;
      state = pushInternal(state, chunk);
      return syncMirror();
    },
    finish(): ParseEvent[] {
      openLineRoot = null;
      state = finishInternal(state);
      return syncMirror();
    },
    get root(): MarkdownDocumentNode | null {
      if (state.rootId === null) return null;
      const committed = (mirror.get(state.rootId) ?? null) as MarkdownDocumentNode | null;
      // Fast path: nothing buffered → the stable committed document.
      if (!committed || !state.lineBuffer) return committed;
      // Open line present → graft its parsed, streaming projection (B.2), once.
      if (!openLineRoot) openLineRoot = buildStreamingRoot(committed);
      return openLineRoot;
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

function contentLength(ast: AstNode): number {
  if ('text' in ast) return (ast as any).text.length;
  if ('raw' in ast) return (ast as any).raw.length;
  return 0;
}

function unescapePointer(s: string): string {
  return s.replace(/~1/g, '/').replace(/~0/g, '~');
}
