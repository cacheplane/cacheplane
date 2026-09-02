// SPDX-License-Identifier: MIT
//
// Push-style parser API layered on top of the immutable pull-style state
// machine. After every operation, the committed state plus its open-line
// preview are reconciled into one canonical public tree.

import { createInternal } from './create';
import { pushInternal } from './push';
import { finishInternal } from './finish';
import { handleBlockLine } from './handlers/block';
import { detectHtmlBlockStart } from './handlers/html';
import {
  ATX_HEADING_RE,
  BLOCKQUOTE_PREFIX_RE,
  CITATION_DEF_RE,
  FENCE_OPEN_RE,
  LINK_DEF_RE,
  ORDERED_LIST_MARKER_RE,
  THEMATIC_BREAK_RE,
  UNORDERED_LIST_MARKER_RE,
} from './internals';
import type {
  AstNode,
  CitationDefinition,
  InternalState,
  LinkDefinition,
  MarkdownDocumentNode,
  MarkdownInlineNode,
  MarkdownNode,
  ParseEvent,
  PartialMarkdownParser,
  PartialMarkdownParserOptions,
  StreamStatus,
} from './types';

interface VisibleNode {
  ast: AstNode;
  parserId: number;
  parentParserId: number | null;
  index: number | null;
  status: StreamStatus;
  children: VisibleNode[];
}

interface PublicEntry {
  visible: VisibleNode;
  node: MarkdownNode;
  children: PublicEntry[];
  scalars: Record<string, unknown>;
  completed: boolean;
}

const STRUCTURAL_AST_KEYS = new Set(['id', 'kind', 'parentId', 'status', 'children']);
const INLINE_REINTERPRET_RE = /[\\*_~`\[\]!()<>$\r\n]/;
const INDENTED_CODE_RE = /^(?: {4}|\t)/;
const TABLE_HEADER_PREFIX_RE = /^ {0,3}\|[^|]*\|/;
const POSSIBLE_HTML_BLOCK_RE = /^ {0,3}</;
const DISPLAY_DOLLAR_MATH_RE = /^ {0,3}\$\$/;
const DISPLAY_BRACKET_MATH_RE = /^ {0,3}\\\[/;

export function createPartialMarkdownParser(options?: PartialMarkdownParserOptions): PartialMarkdownParser {
  let state: InternalState = createInternal(options);
  let rootEntry: PublicEntry | null = null;
  let publicRoot: MarkdownDocumentNode | null = null;

  const usedPublicIds = new Set<number>();
  let nextPublicId = 0;
  const sidecarNodes = new Map<string, MarkdownNode>();
  const sidecarIds = new Map<string, number>();
  const literalAutolinkScanner = createLiteralAutolinkScanner();

  function allocatePublicId(): number {
    while (usedPublicIds.has(nextPublicId)) nextPublicId += 1;
    const id = nextPublicId;
    nextPublicId += 1;
    usedPublicIds.add(id);
    return id;
  }

  function allocateSidecarId(identity: string): number {
    const existing = sidecarIds.get(identity);
    if (existing !== undefined) return existing;
    const id = allocatePublicId();
    sidecarIds.set(identity, id);
    return id;
  }

  function buildVisibleTree(currentState: InternalState): { root: VisibleNode | null; source: InternalState } {
    if (currentState.rootId === null) return { root: null, source: currentState };

    const needsPreview =
      !currentState.complete &&
      (currentState.lineBuffer.length > 0 || currentState.tablePending !== null);
    const source = needsPreview
      ? handleBlockLine(
          { ...currentState, lineBuffer: '', optimisticInline: true, optimisticBlock: true },
          currentState.lineBuffer,
        )
      : currentState;

    const visit = (
      id: number,
      parentParserId: number | null,
      index: number | null,
    ): VisibleNode => {
      const ast = source.nodes[id]!;
      const childIds = 'children' in ast ? (ast.children as number[]) : [];
      const projected = needsPreview && ast !== currentState.nodes[id];
      const visible: VisibleNode = {
        ast,
        parserId: id,
        parentParserId,
        index,
        status: projected ? 'streaming' : ast.status,
        children: [],
      };
      visible.children = childIds.map((childId, childIndex) => visit(childId, id, childIndex));
      return visible;
    };

    return { root: visit(source.rootId!, null, null), source };
  }

  function reconcile(): ParseEvent[] {
    const { root: nextVisibleRoot, source } = buildVisibleTree(state);
    if (!nextVisibleRoot) {
      rootEntry = null;
      publicRoot = null;
      return [];
    }

    const oldEntries = rootEntry ? preOrder(rootEntry) : [];
    const oldPostOrder = rootEntry ? postOrder(rootEntry) : [];
    const oldByMatch = new Map(oldEntries.map((entry) => [matchKey(entry.visible), entry]));
    const nextVisible = visiblePreOrder(nextVisibleRoot);
    const matchedOld = new Set<PublicEntry>();

    for (const visible of nextVisible) {
      const old = oldByMatch.get(matchKey(visible));
      if (old) matchedOld.add(old);
    }

    const removed = new Set(oldEntries.filter((entry) => !matchedOld.has(entry)));
    const reinterpretations = new Map<string, PublicEntry>();
    for (const entry of removed) {
      if (!entry.completed) reinterpretations.set(positionKey(entry.visible), entry);
    }

    const newEntries = new Set<PublicEntry>();
    const updatedEntries = new Map<PublicEntry, string | undefined>();

    const construct = (visible: VisibleNode): PublicEntry => {
      const exact = oldByMatch.get(matchKey(visible));
      let entry: PublicEntry;

      if (exact) {
        entry = exact;
        const nextScalars = snapshotScalars(visible.ast);
        const delta = scalarDelta(entry.scalars, nextScalars);
        if (!scalarRecordsEqual(entry.scalars, nextScalars)) updatedEntries.set(entry, delta);
        applyScalars(entry.node, nextScalars, entry.scalars);
        entry.scalars = nextScalars;
        entry.visible = visible;
      } else {
        const replaced = reinterpretations.get(positionKey(visible));
        const canReuse = replaced !== undefined && replaced.visible.ast.kind !== visible.ast.kind;
        const publicId = canReuse ? replaced.node.id : allocatePublicId();
        entry = {
          visible,
          node: createPublicNode(visible.ast, publicId, visible.status),
          children: [],
          scalars: snapshotScalars(visible.ast),
          completed: false,
        };
        newEntries.add(entry);
      }

      entry.children = visible.children.map(construct);
      wireChildren(entry);
      return entry;
    };

    const nextRootEntry = construct(nextVisibleRoot);
    const nextPreOrder = preOrder(nextRootEntry);
    const removedCompletionEvents: ParseEvent[] = [];

    // Removed objects remain valid completion payloads and complete post-order.
    for (const entry of oldPostOrder) {
      if (removed.has(entry) && !entry.completed) {
        entry.node.status = 'complete';
        entry.completed = true;
        removedCompletionEvents.push({ type: 'node-completed', node: entry.node });
      }
    }

    const creationEvents = nextPreOrder
      .filter((entry) => newEntries.has(entry))
      .map<ParseEvent>((entry) => ({ type: 'node-created', node: entry.node }));

    // Immediate and retained status completions follow structural pre-order.
    // Newly complete nodes still have creation ordered before completion.
    const statusCompletionEvents: ParseEvent[] = [];
    for (const entry of nextPreOrder) {
      const completesImmediately = newEntries.has(entry) && entry.visible.status === 'complete';
      const retainedCompletion =
        !newEntries.has(entry) && entry.visible.status === 'complete' && entry.node.status !== 'complete';
      if ((completesImmediately || retainedCompletion) && !entry.completed) {
        entry.node.status = 'complete';
        entry.completed = true;
        statusCompletionEvents.push({ type: 'node-completed', node: entry.node });
      }
    }

    // Apply final statuses after completion detection so streaming-to-complete
    // transitions cannot be hidden by scalar reconciliation.
    for (const entry of nextPreOrder) entry.node.status = entry.visible.status;

    const updateEvents = nextPreOrder
      .filter((entry) => !newEntries.has(entry) && updatedEntries.has(entry))
      .map<ParseEvent>((entry) => ({
        type: 'value-updated',
        node: entry.node,
        delta: updatedEntries.get(entry),
      }));

    rootEntry = nextRootEntry;
    publicRoot = nextRootEntry.node as MarkdownDocumentNode;
    syncSidecars(source, publicRoot);

    return [...removedCompletionEvents, ...creationEvents, ...statusCompletionEvents, ...updateEvents];
  }

  function syncSidecars(source: InternalState, root: MarkdownDocumentNode): void {
    const sidecarNode = (owner: string, id: number): MarkdownNode | undefined => {
      const ast = source.nodes[id];
      if (!ast) return undefined;
      const key = `${owner}:${id}:${ast.kind}`;
      let node = sidecarNodes.get(key);
      const scalars = snapshotScalars(ast);
      if (!node) {
        node = createPublicNode(ast, allocateSidecarId(key), ast.status);
        sidecarNodes.set(key, node);
      } else {
        applyScalars(node, scalars);
        node.status = ast.status;
      }
      if ('children' in ast && 'children' in node) {
        const children = (ast.children as number[])
          .map((childId) => sidecarNode(owner, childId))
          .filter((child): child is MarkdownNode => child !== undefined);
      children.forEach((child, index) => {
        child.parent = node!;
        if (child.type !== 'citation-reference') child.index = index;
      });
        (node as { children: MarkdownNode[] }).children = children;
      }
      return node;
    };

    for (const [refId, def] of source.citationDefs) {
      const owner = `citation:${refId}`;
      const children = def.childAstIds
        .map((childId) => sidecarNode(owner, childId))
        .filter((node): node is MarkdownInlineNode => node !== undefined);
      children.forEach((child) => {
        child.parent = null;
      });
      const existing = root.citations.get(refId);
      if (existing) {
        existing.index = def.index;
        existing.status = def.status;
        existing.children = children;
      } else {
        root.citations.set(refId, { id: refId, index: def.index, status: def.status, children });
      }
    }
    for (const refId of root.citations.keys()) {
      if (!source.citationDefs.has(refId)) root.citations.delete(refId);
    }

    for (const [refId, def] of source.linkDefs) {
      const existing = root.linkDefinitions.get(refId);
      if (existing) Object.assign(existing, def);
      else root.linkDefinitions.set(refId, { ...def });
    }
    for (const refId of root.linkDefinitions.keys()) {
      if (!source.linkDefs.has(refId)) root.linkDefinitions.delete(refId);
    }
  }

  function incrementalPlainTextEntry(
    chunk: string,
    literalAutolinkCompleted: boolean,
  ): PublicEntry | null {
    if (
      chunk.length === 0 ||
      INLINE_REINTERPRET_RE.test(chunk) ||
      state.complete ||
      state.mode !== 'block' ||
      state.rootId === null ||
      state.stack.length !== 1 ||
      state.stack[0] !== state.rootId ||
      state.currentNodeId !== null ||
      state.listStack.length !== 0 ||
      state.tablePending !== null ||
      state.codeFenceMarker !== null ||
      state.mathOpener !== null ||
      state.mathNodeId !== null ||
      state.htmlBlockKind !== null ||
      state.htmlBlockNodeId !== null ||
      state.htmlInlinePending.length !== 0 ||
      state.textBuffer.length !== 0 ||
      state.optimisticInline === true ||
      state.optimisticBlock === true ||
      state.lineBuffer.length === 0 ||
      INLINE_REINTERPRET_RE.test(state.lineBuffer[state.lineBuffer.length - 1]!) ||
      rootEntry === null ||
      publicRoot !== rootEntry.node
    ) {
      return null;
    }

    const paragraph = rootEntry.children[rootEntry.children.length - 1];
    if (
      !paragraph ||
      paragraph.node.type !== 'paragraph' ||
      paragraph.visible.ast.kind !== 'paragraph' ||
      paragraph.node.status !== 'streaming' ||
      paragraph.visible.status !== 'streaming' ||
      paragraph.children.length !== 1 ||
      rootEntry.visible.children[rootEntry.visible.children.length - 1] !== paragraph.visible
    ) {
      return null;
    }

    const text = paragraph.children[0]!;
    if (
      text.node.type !== 'text' ||
      text.node.status !== 'streaming' ||
      text.visible.status !== 'streaming' ||
      text.visible.ast.kind !== 'text' ||
      text.children.length !== 0 ||
      paragraph.visible.children.length !== 1 ||
      paragraph.visible.children[0] !== text.visible ||
      text.node.parent !== paragraph.node ||
      text.visible.ast.text !== state.lineBuffer ||
      text.scalars.text !== state.lineBuffer ||
      !('text' in text.node) ||
      text.node.text !== state.lineBuffer
    ) {
      return null;
    }

    if (literalAutolinkCompleted) return null;
    if (wouldReinterpretTopLevelParagraph(state.lineBuffer, chunk, state)) return null;

    return text;
  }

  function updateIncrementalPlainText(entry: PublicEntry, delta: string): ParseEvent[] {
    entry.visible.ast = { ...entry.visible.ast, text: state.lineBuffer } as AstNode;
    (entry.node as MarkdownNode & { text: string }).text = state.lineBuffer;
    entry.scalars.text = state.lineBuffer;
    return [{ type: 'value-updated', node: entry.node, delta }];
  }

  const parser: PartialMarkdownParser = {
    push(chunk: string): ParseEvent[] {
      if (chunk.length === 0 || state.complete || state.error) return [];
      const literalAutolinkCompleted = literalAutolinkScanner.consume(chunk);
      const incrementalText = incrementalPlainTextEntry(chunk, literalAutolinkCompleted);
      state = pushInternal(state, chunk);
      if (incrementalText) return updateIncrementalPlainText(incrementalText, chunk);
      return reconcile();
    },
    finish(): ParseEvent[] {
      state = finishInternal(state);
      return reconcile();
    },
    get root(): MarkdownDocumentNode | null {
      return publicRoot;
    },
    getByPath(path: string): MarkdownNode | null {
      if (path === '') return publicRoot;
      if (!path.startsWith('/')) return null;
      const segments = path.slice(1).split('/').map(unescapePointer);
      let node: MarkdownNode | null = publicRoot;
      for (let i = 0; i < segments.length;) {
        if (!node || segments[i] !== 'children' || !('children' in node)) return null;
        const rawIndex = segments[i + 1];
        if (rawIndex === undefined || !/^\d+$/.test(rawIndex)) return null;
        node = (node.children as MarkdownNode[])[Number(rawIndex)] ?? null;
        i += 2;
      }
      return node;
    },
  };

  return parser;
}

function createPublicNode(ast: AstNode, id: number, status: StreamStatus): MarkdownNode {
  const node: Record<string, unknown> = {
    id,
    type: ast.kind,
    status,
    parent: null,
    index: null,
    ...snapshotScalars(ast),
  };
  if ('children' in ast) node.children = [];
  if (ast.kind === 'document') {
    node.citations = new Map<string, CitationDefinition>();
    node.linkDefinitions = new Map<string, LinkDefinition>();
  }
  return node as unknown as MarkdownNode;
}

function snapshotScalars(ast: AstNode): Record<string, unknown> {
  const scalars: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ast)) {
    if (STRUCTURAL_AST_KEYS.has(key)) continue;
    scalars[key] = cloneScalar(value);
  }
  return scalars;
}

function cloneScalar(value: unknown): unknown {
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === 'object') return { ...value };
  return value;
}

function applyScalars(
  node: MarkdownNode,
  next: Record<string, unknown>,
  previous: Record<string, unknown> = {},
): void {
  const target = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(previous)) {
    if (!(key in next)) delete target[key];
  }
  Object.assign(target, next);
}

function scalarRecordsEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => scalarEqual(left[key], right[key]));
}

function scalarEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

function scalarDelta(previous: Record<string, unknown>, next: Record<string, unknown>): string | undefined {
  for (const key of ['text', 'raw']) {
    const before = previous[key];
    const after = next[key];
    if (typeof before === 'string' && typeof after === 'string' && after.startsWith(before)) {
      return after.slice(before.length);
    }
  }
  return undefined;
}

function wireChildren(entry: PublicEntry): void {
  if (!('children' in entry.node)) return;
  const children = entry.children.map((child, index) => {
    child.node.parent = entry.node;
    if (child.node.type !== 'citation-reference') child.node.index = index;
    return child.node;
  });
  (entry.node as { children: MarkdownNode[] }).children = children;
}

function matchKey(node: VisibleNode): string {
  return `${node.parserId}:${node.ast.kind}:${node.parentParserId ?? 'root'}:${node.index ?? 'root'}`;
}

function positionKey(node: VisibleNode): string {
  return `${node.parserId}:${node.parentParserId ?? 'root'}:${node.index ?? 'root'}`;
}

interface LiteralAutolinkScanner {
  consume(chunk: string): boolean;
}

function createLiteralAutolinkScanner(): LiteralAutolinkScanner {
  let lineHasAutolink = false;
  let prefix = '';
  let urlNeedsContent = false;
  let emailPhase: 'local' | 'domain' | 'invalid' = 'local';
  let emailLocalLength = 0;
  let emailDomainLength = 0;
  let emailHasFinalDot = false;
  let emailTldLetters = 0;

  const resetToken = (): void => {
    prefix = '';
    urlNeedsContent = false;
    emailPhase = 'local';
    emailLocalLength = 0;
    emailDomainLength = 0;
    emailHasFinalDot = false;
    emailTldLetters = 0;
  };

  const resetLine = (): void => {
    lineHasAutolink = false;
    resetToken();
  };

  return {
    consume(chunk: string): boolean {
      let completed = false;

      for (const character of chunk) {
        if (character === '\n') {
          resetLine();
          continue;
        }
        if (/\s/.test(character)) {
          resetToken();
          continue;
        }
        if (lineHasAutolink) continue;
        if (urlNeedsContent) {
          lineHasAutolink = true;
          completed = true;
          continue;
        }
        if (/[([{"'`]/.test(character)) {
          resetToken();
          continue;
        }

        if (prefix.length < 8) prefix += character;
        if (prefix === 'http://' || prefix === 'https://' || prefix === 'www.') {
          urlNeedsContent = true;
        }

        if (emailPhase === 'local') {
          if (/[A-Za-z0-9._%+-]/.test(character)) {
            emailLocalLength += 1;
          } else if (character === '@' && emailLocalLength > 0) {
            emailPhase = 'domain';
          } else {
            emailPhase = 'invalid';
          }
        } else if (emailPhase === 'domain') {
          if (!/[A-Za-z0-9.-]/.test(character)) {
            emailPhase = 'invalid';
            continue;
          }

          if (character === '.') {
            emailHasFinalDot = emailDomainLength > 0;
            emailTldLetters = 0;
          } else if (emailHasFinalDot && /[A-Za-z]/.test(character)) {
            emailTldLetters += 1;
          } else if (emailHasFinalDot) {
            emailHasFinalDot = false;
            emailTldLetters = 0;
          }
          emailDomainLength += 1;

          if (emailHasFinalDot && emailTldLetters >= 2) {
            lineHasAutolink = true;
            completed = true;
          }
        }
      }

      return completed;
    },
  };
}

function wouldReinterpretTopLevelParagraph(
  lineBuffer: string,
  chunk: string,
  state: InternalState,
): boolean {
  let offset = 0;
  while (offset < lineBuffer.length && offset < 4 && lineBuffer[offset] === ' ') offset += 1;

  const prefix = lineBuffer[offset];
  if (prefix === undefined || offset === 4 || prefix === '\t') {
    const line = lineBuffer + chunk;
    return INDENTED_CODE_RE.test(line) || wouldMatchBlockPrefix(line, chunk, state);
  }

  if (prefix === '|' && !chunk.includes('|')) return false;
  if (!'#>0123456789-*+`~|[$\\<'.includes(prefix)) return false;

  return wouldMatchBlockPrefix(lineBuffer + chunk, chunk, state);
}

function wouldMatchBlockPrefix(line: string, chunk: string, state: InternalState): boolean {
  return (
    ATX_HEADING_RE.test(line) ||
    BLOCKQUOTE_PREFIX_RE.test(line) ||
    ORDERED_LIST_MARKER_RE.test(line) ||
    UNORDERED_LIST_MARKER_RE.test(line) ||
    FENCE_OPEN_RE.test(line) ||
    THEMATIC_BREAK_RE.test(line) ||
    (chunk.includes('|') && TABLE_HEADER_PREFIX_RE.test(line)) ||
    CITATION_DEF_RE.test(line) ||
    LINK_DEF_RE.test(line) ||
    (state.options.math.dollar && DISPLAY_DOLLAR_MATH_RE.test(line)) ||
    (state.options.math.bracket && DISPLAY_BRACKET_MATH_RE.test(line)) ||
    (POSSIBLE_HTML_BLOCK_RE.test(line) && detectHtmlBlockStart(line) !== null)
  );
}

function visiblePreOrder(root: VisibleNode): VisibleNode[] {
  return [root, ...root.children.flatMap(visiblePreOrder)];
}

function preOrder(root: PublicEntry): PublicEntry[] {
  return [root, ...root.children.flatMap(preOrder)];
}

function postOrder(root: PublicEntry): PublicEntry[] {
  return [...root.children.flatMap(postOrder), root];
}

function unescapePointer(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}
