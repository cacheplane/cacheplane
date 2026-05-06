// SPDX-License-Identifier: MIT
import type {
  InternalState,
  HeadingAstNode,
  ThematicBreakAstNode,
  ParagraphAstNode,
  CodeBlockAstNode,
  BlockquoteAstNode,
  ListAstNode,
  ListItemAstNode,
  CitationReferenceAstNode,
  TableAstNode,
  TableRowAstNode,
  TableCellAstNode,
  Alignment,
} from '../types';
import {
  allocId,
  appendNode,
  appendChild,
  setStatus,
  pushWarning,
  THEMATIC_BREAK_RE,
  ATX_HEADING_RE,
  FENCE_OPEN_RE,
  BLOCKQUOTE_PREFIX_RE,
  CITATION_DEF_RE,
  TABLE_ROW_RE,
  TABLE_ALIGNMENT_RE,
  parseAlignmentRow,
  getOrAssignCitationIndex,
  TASK_MARKER_RE,
  measureLine,
} from '../internals';
import type { LineMeasurement } from '../internals';
import { parseInline } from './inline';

export function handleBlockLine(state: InternalState, line: string): InternalState {
  if (state.mode === 'code-fence') return handleCodeFenceLine(state, line);

  // If we have a pending table-header candidate, this line decides:
  //   - alignment row → promote candidate to table
  //   - anything else → flush candidate as a paragraph, then process this line
  if (state.tablePending !== null) {
    const trimmed = line.trim();
    if (TABLE_ALIGNMENT_RE.test(trimmed)) {
      const alignments = parseAlignmentRow(trimmed)!;
      const headerLine = state.tablePending.headerLine;
      let s: InternalState = { ...state, tablePending: null, line: state.line + 1, lineBuffer: '' };
      s = commitTable(s, headerLine, alignments);
      return s;
    }
    // Revert: the buffered header was actually a paragraph.
    let s: InternalState = { ...state, tablePending: null };
    s = appendOrExtendParagraph(s, state.tablePending.headerLine);
    s = closeOpenParagraph(s);
    // Fall through to process the current line normally (reassign state).
    state = s;
  }

  let s: InternalState = { ...state, line: state.line + 1, lineBuffer: '' };

  // Close open table if current line is not a table row.
  if (s.mode === 'table' && !TABLE_ROW_RE.test(line)) {
    s = closeOpenTable(s);
  }

  // Blank line: close any open paragraph/list (and its enclosing blockquote).
  if (line.length === 0) {
    let blankState = closeOpenParagraph(s);
    blankState = closeOpenList(blankState);
    return blankState;
  }

  // Block-level recognizers (each closes any open paragraph first).
  if (THEMATIC_BREAK_RE.test(line)) {
    s = closeOpenParagraph(s);
    s = closeOpenList(s);
    return appendThematicBreak(s);
  }

  const atx = ATX_HEADING_RE.exec(line);
  if (atx) {
    s = closeOpenParagraph(s);
    s = closeOpenList(s);
    const level = (atx[1]?.length ?? 1) as 1 | 2 | 3 | 4 | 5 | 6;
    const content = atx[2] ?? '';
    return appendHeading(s, level, content);
  }

  const fence = FENCE_OPEN_RE.exec(line);
  if (fence) {
    s = closeOpenParagraph(s);
    s = closeOpenList(s);
    return openFencedCodeBlock(s, fence[1] as '```' | '~~~', fence[2] ?? '');
  }

  // Measure indentation + detect list marker with a single pass.
  const measurement = measureLine(line);
  if (measurement.marker !== null) {
    return openOrExtendListIndentAware(s, line, measurement);
  }

  if (BLOCKQUOTE_PREFIX_RE.test(line)) {
    return openOrExtendBlockquote(s, line.replace(BLOCKQUOTE_PREFIX_RE, ''));
  }

  // Citation definition: lifts to citationDefs sidecar (no block-tree node).
  const citeDef = CITATION_DEF_RE.exec(line);
  if (citeDef) {
    s = closeOpenParagraph(s);
    s = closeOpenList(s);
    return liftCitationDef(s, citeDef[1]!, citeDef[2] ?? '');
  }

  // Mid-table body row: append to active table.
  if (s.mode === 'table' && TABLE_ROW_RE.test(line)) {
    return appendTableRow(s, line);
  }

  // Candidate table header: starts with `|`, contains `|`. Buffer for lookahead.
  if (TABLE_ROW_RE.test(line)) {
    s = closeOpenParagraph(s);
    s = closeOpenList(s);
    return { ...s, tablePending: { headerLine: line, paragraphId: null } };
  }

  // If inside a list, non-marker lines may be lazy continuation.
  if (s.listStack.length > 0) {
    const innermost = s.listStack[s.listStack.length - 1]!;
    if (measurement.leadingCols >= innermost.contentCol) {
      // Lazy continuation: append to current item's open paragraph.
      const cur = s.currentNodeId != null ? s.nodes[s.currentNodeId] : undefined;
      if (cur && cur.kind === 'paragraph' && cur.status === 'streaming') {
        return appendLineToParagraph(s, s.currentNodeId!, line.slice(measurement.contentStart));
      }
    }
    // Not enough indent to continue — close lists and fall through.
    s = closeOpenParagraph(s);
    s = closeOpenList(s);
    return appendOrExtendParagraph(s, line);
  }

  // Paragraph fallthrough (closing any open list first).
  s = closeOpenList(s);
  return appendOrExtendParagraph(s, line);
}

// ── Block constructors ────────────────────────────────────────────────────

function appendThematicBreak(state: InternalState): InternalState {
  const docId = state.rootId!;
  const [s1, id] = allocId(state);
  const node: ThematicBreakAstNode = {
    id, kind: 'thematic-break', parentId: docId, status: 'complete',
  };
  return appendChild(appendNode(s1, node), docId, id);
}

function appendHeading(state: InternalState, level: 1 | 2 | 3 | 4 | 5 | 6, content: string): InternalState {
  const docId = state.rootId!;
  const [s1, headingId] = allocId(state);
  const heading: HeadingAstNode = {
    id: headingId, kind: 'heading', parentId: docId, status: 'streaming', level, children: [],
  };
  let s = appendChild(appendNode(s1, heading), docId, headingId);
  if (content.length > 0) {
    s = parseInline(s, headingId, content);
  }
  return setStatus(s, headingId, 'complete');
}

function openFencedCodeBlock(
  state: InternalState,
  fenceChar: '```' | '~~~',
  language: string,
): InternalState {
  const docId = state.rootId!;
  const [s1, id] = allocId(state);
  const node: CodeBlockAstNode = {
    id, kind: 'code-block', parentId: docId, status: 'streaming',
    variant: 'fenced', language, text: '',
  };
  const s = appendChild(appendNode(s1, node), docId, id);
  return {
    ...s,
    mode: 'code-fence',
    stack: [...s.stack, id],
    currentNodeId: id,
    lineBuffer: fenceChar,
  };
}

function handleCodeFenceLine(state: InternalState, line: string): InternalState {
  const fenceChar = state.lineBuffer;
  const id = state.currentNodeId;
  if (id == null) return { ...state, mode: 'block', lineBuffer: '' };
  const trimmed = line.trim();
  const isCloser =
    (fenceChar === '```' && /^`{3,}\s*$/.test(trimmed)) ||
    (fenceChar === '~~~' && /^~{3,}\s*$/.test(trimmed));

  if (isCloser) {
    let s = setStatus(state, id, 'complete');
    return {
      ...s,
      mode: 'block',
      stack: s.stack.slice(0, -1),
      currentNodeId: null,
      lineBuffer: '',
      line: state.line + 1,
    };
  }

  const node = state.nodes[id];
  if (!node || node.kind !== 'code-block') return state;
  const updated: CodeBlockAstNode = {
    ...node,
    text: node.text.length > 0 ? `${node.text}\n${line}` : line,
  };
  const nodes = state.nodes.slice();
  nodes[id] = updated;
  return { ...state, nodes, line: state.line + 1 };
}

// ── Paragraph ─────────────────────────────────────────────────────────────

export function appendOrExtendParagraph(state: InternalState, line: string): InternalState {
  const cur = state.currentNodeId != null ? state.nodes[state.currentNodeId] : undefined;
  if (cur && cur.kind === 'paragraph' && cur.status === 'streaming') {
    return appendLineToParagraph(state, state.currentNodeId!, line);
  }
  return openParagraph(state, line);
}

function openParagraph(state: InternalState, line: string): InternalState {
  const docId = state.rootId!;
  const [s1, paraId] = allocId(state);
  const para: ParagraphAstNode = {
    id: paraId, kind: 'paragraph', parentId: docId, status: 'streaming', children: [],
  };
  let s = appendChild(appendNode(s1, para), docId, paraId);
  s = parseInline(s, paraId, line);
  return { ...s, currentNodeId: paraId };
}

function appendLineToParagraph(state: InternalState, paraId: number, line: string): InternalState {
  let s = state;
  const [s1, sbId] = allocId(s);
  s = appendChild(appendNode(s1, {
    id: sbId, kind: 'soft-break', parentId: paraId, status: 'complete',
  }), paraId, sbId);
  return parseInline(s, paraId, line);
}

export function closeOpenParagraph(state: InternalState): InternalState {
  let s = state;
  const cur = state.currentNodeId != null ? state.nodes[state.currentNodeId] : undefined;
  if (cur && cur.kind === 'paragraph') {
    s = setStatus(s, state.currentNodeId!, 'complete');
    const para = s.nodes[state.currentNodeId!] as ParagraphAstNode;
    for (const childId of para.children) {
      const child = s.nodes[childId];
      if (child && child.status !== 'complete') s = setStatus(s, childId, 'complete');
    }
    s = { ...s, currentNodeId: null };
  }
  // If a blockquote is open at the top of the stack, close it as well.
  const topId = s.stack[s.stack.length - 1];
  const top = topId != null ? s.nodes[topId] : undefined;
  if (top && top.kind === 'blockquote' && topId != null) {
    s = setStatus(s, topId, 'complete');
    s = { ...s, stack: s.stack.slice(0, -1) };
  }
  return s;
}

// ── Blockquote ────────────────────────────────────────────────────────────

function openOrExtendBlockquote(state: InternalState, innerLine: string): InternalState {
  const topId = state.stack[state.stack.length - 1];
  const top = topId != null ? state.nodes[topId] : undefined;
  if (top && top.kind === 'blockquote' && top.status === 'streaming') {
    return appendOrExtendParagraph(state, innerLine);
  }
  // Open a new blockquote.
  const docId = state.rootId!;
  const [s1, bqId] = allocId(state);
  const bq: BlockquoteAstNode = {
    id: bqId, kind: 'blockquote', parentId: docId, status: 'streaming', children: [],
  };
  let s = appendChild(appendNode(s1, bq), docId, bqId);
  s = { ...s, stack: [...s.stack, bqId] };
  return appendOrExtendParagraph(s, innerLine);
}

// ── Lists ─────────────────────────────────────────────────────────────────

/**
 * Strip the marker prefix (e.g. `- ` or `10. `) from a line's content portion.
 * `contentStart` is the byte index where non-whitespace begins.
 */
function stripMarkerPrefix(line: string, contentStart: number, ordered: boolean): string {
  const rest = line.slice(contentStart);
  if (ordered) {
    return rest.replace(/^\d{1,9}[.)]\s+/, '');
  }
  return rest.replace(/^[-*+]\s+/, '');
}

/**
 * Indent-aware list dispatcher. Walks listStack innermost-to-outermost to
 * decide between sibling-extend, nested-open, or close-all-and-open-new.
 */
function openOrExtendListIndentAware(
  state: InternalState,
  line: string,
  measurement: LineMeasurement,
): InternalState {
  const { leadingCols, contentStart, marker } = measurement;
  if (marker === null) return state;

  const thisMarkerCol = leadingCols;
  const thisOrdered = marker.ordered;
  const thisStart = marker.start;
  const thisContentCol = marker.markerEndCol;
  const body = stripMarkerPrefix(line, contentStart, thisOrdered);

  // Walk stack innermost-to-outermost.
  for (let i = state.listStack.length - 1; i >= 0; i--) {
    const entry = state.listStack[i]!;

    if (entry.markerCol === thisMarkerCol && entry.ordered === thisOrdered) {
      // Sibling extend: same column, same list type.
      // Close any deeper stack entries.
      let s: InternalState = state;
      for (let j = state.listStack.length - 1; j > i; j--) {
        const innerId = state.listStack[j]!.listId;
        s = closeListAllItems(s, innerId);
        s = setStatus(s, innerId, 'complete');
      }
      s = closeOpenParagraph(s);
      s = { ...s, listStack: s.listStack.slice(0, i + 1) };
      return appendListItem(s, entry.listId, body);
    }

    if (entry.markerCol < thisMarkerCol) {
      // Potential nested open: this marker is indented past the parent entry.
      // Accept if either strict (past contentCol) or tolerance (≥ 2-space relative) passes.
      const strictOk = thisMarkerCol >= entry.contentCol;
      const toleranceOk = thisMarkerCol >= entry.markerCol + 2;
      if (strictOk || toleranceOk) {
        // Find the last item in the parent list (entry.listId).
        const parentList = state.nodes[entry.listId] as ListAstNode | undefined;
        if (!parentList || parentList.children.length === 0) break;
        const parentItemId = parentList.children[parentList.children.length - 1]!;

        let s2: InternalState = closeOpenParagraph(state);
        const [s3, listId] = allocId(s2);
        const newList: ListAstNode = {
          id: listId,
          kind: 'list',
          parentId: parentItemId,
          status: 'streaming',
          ordered: thisOrdered,
          start: thisStart,
          tight: true,
          markerCol: thisMarkerCol,
          contentCol: thisContentCol,
          children: [],
        };
        s2 = appendNode(s3, newList);
        s2 = appendChild(s2, parentItemId, listId);
        s2 = {
          ...s2,
          listStack: [
            ...s2.listStack.slice(0, i + 1),
            { listId, ordered: thisOrdered, markerCol: thisMarkerCol, contentCol: thisContentCol },
          ],
        };
        return appendListItem(s2, listId, body);
      }
      // 1-space relative indent or less: treat as lazy continuation → not a nest.
      break;
    }

    // entry.markerCol > thisMarkerCol: we dedented past this entry — keep walking outward.
  }

  // No match found — close all open lists, open new top-level list at document root.
  let s: InternalState = closeOpenParagraph(state);
  s = closeOpenList(s);
  const docId = s.rootId!;
  const [s1, listId] = allocId(s);
  const newList: ListAstNode = {
    id: listId,
    kind: 'list',
    parentId: docId,
    status: 'streaming',
    ordered: thisOrdered,
    start: thisStart,
    tight: true,
    markerCol: thisMarkerCol,
    contentCol: thisContentCol,
    children: [],
  };
  s = appendNode(s1, newList);
  s = appendChild(s, docId, listId);
  s = {
    ...s,
    listStack: [{ listId, ordered: thisOrdered, markerCol: thisMarkerCol, contentCol: thisContentCol }],
  };
  return appendListItem(s, listId, body);
}

/**
 * Close all open lists from the listStack (innermost-to-outermost).
 * Clears both stack and listStack. Used on blank lines, headings, etc.
 */
function closeOpenList(state: InternalState): InternalState {
  if (state.listStack.length === 0) {
    // Legacy: also handle old-style stack-based list tracking.
    const topId = state.stack[state.stack.length - 1];
    const top = topId != null ? state.nodes[topId] : undefined;
    if (!top || top.kind !== 'list' || topId == null) return state;
    let s = setStatus(state, topId, 'complete');
    const list = s.nodes[topId] as ListAstNode;
    for (const itemId of list.children) {
      s = closeListItemRecursive(s, itemId);
    }
    return { ...s, stack: s.stack.slice(0, -1), currentNodeId: null };
  }

  let s = state;
  for (let i = s.listStack.length - 1; i >= 0; i--) {
    const entry = s.listStack[i]!;
    s = closeListAllItems(s, entry.listId);
    s = setStatus(s, entry.listId, 'complete');
  }
  return { ...s, listStack: [], currentNodeId: null };
}

/**
 * Close all items in a list node (does not close the list itself).
 */
function closeListAllItems(state: InternalState, listId: number): InternalState {
  let s = state;
  const list = s.nodes[listId] as ListAstNode | undefined;
  if (!list) return s;
  for (const itemId of list.children) {
    s = closeListItemRecursive(s, itemId);
  }
  return s;
}

function closeListItemRecursive(state: InternalState, itemId: number): InternalState {
  let s = setStatus(state, itemId, 'complete');
  const item = s.nodes[itemId];
  if (!item || !('children' in item)) return s;
  for (const childId of item.children) {
    const child = s.nodes[childId];
    if (!child) continue;
    if (child.kind === 'paragraph') {
      s = setStatus(s, childId, 'complete');
      for (const grandId of child.children) {
        const grand = s.nodes[grandId];
        if (grand && grand.status !== 'complete') s = setStatus(s, grandId, 'complete');
      }
    } else if (child.status !== 'complete') {
      s = setStatus(s, childId, 'complete');
    }
  }
  return s;
}

function appendListItem(state: InternalState, listId: number, content: string): InternalState {
  // Detect GFM task marker at the leading edge of content.
  const taskMatch = TASK_MARKER_RE.exec(content);
  let task: { checked: boolean } | undefined;
  let body = content;
  if (taskMatch) {
    task = { checked: taskMatch[1] === 'x' || taskMatch[1] === 'X' };
    body = content.slice(taskMatch[0].length);
  }

  const [s1, itemId] = allocId(state);
  const item: ListItemAstNode = {
    id: itemId, kind: 'list-item', parentId: listId, status: 'streaming',
    ...(task !== undefined ? { task } : {}),
    children: [],
  };
  let s = appendChild(appendNode(s1, item), listId, itemId);
  s = { ...s, currentNodeId: itemId };
  return openParagraphInside(s, itemId, body);
}

function openParagraphInside(state: InternalState, parentId: number, line: string): InternalState {
  const [s1, paraId] = allocId(state);
  const para: ParagraphAstNode = {
    id: paraId, kind: 'paragraph', parentId, status: 'streaming', children: [],
  };
  let s = appendChild(appendNode(s1, para), parentId, paraId);
  if (line.length > 0) {
    s = parseInline(s, paraId, line);
  }
  return { ...s, currentNodeId: paraId };
}

// ── Tables ────────────────────────────────────────────────────────────────

function closeOpenTable(state: InternalState): InternalState {
  if (state.mode !== 'table') return state;
  const tableId = state.currentNodeId;
  if (tableId === null) return { ...state, mode: 'block' };
  let s = setStatus(state, tableId, 'complete');
  return { ...s, mode: 'block', currentNodeId: null };
}

function commitTable(
  state: InternalState,
  headerLine: string,
  alignments: ReadonlyArray<Alignment>,
): InternalState {
  const docId = state.rootId!;
  const [s1, tableId] = allocId(state);
  const table: TableAstNode = {
    id: tableId,
    kind: 'table',
    parentId: docId,
    status: 'streaming',
    alignments,
    children: [],
  };
  let s = appendNode(s1, table);
  s = appendChild(s, docId, tableId);
  s = appendTableRow({ ...s, mode: 'table', currentNodeId: tableId }, headerLine, true);
  return s;
}

function appendTableRow(
  state: InternalState,
  line: string,
  isHeader = false,
): InternalState {
  const tableId = state.currentNodeId;
  if (tableId === null) return state;
  const table = state.nodes[tableId];
  if (!table || table.kind !== 'table') return state;

  const [s1, rowId] = allocId(state);
  const row: TableRowAstNode = {
    id: rowId,
    kind: 'table-row',
    parentId: tableId,
    status: 'streaming',
    isHeader,
    children: [],
  };
  let s = appendNode(s1, row);
  s = appendChild(s, tableId, rowId);

  // Tokenize cells.
  const cellTexts = splitTableCells(line);
  const headerWidth = (table as TableAstNode).alignments.length;

  // Truncate with warning if over (body rows only).
  if (!isHeader && cellTexts.length > headerWidth) {
    s = pushWarning(s, {
      code: 'table_overflow',
      index: s.index,
      detail: `row had ${cellTexts.length} cells, header has ${headerWidth}`,
    });
  }

  // Determine target cell count: header uses its own count; body pads to headerWidth.
  const targetCells = isHeader ? cellTexts.length : headerWidth;

  for (let i = 0; i < targetCells; i++) {
    // For body rows, stop if we have exhausted cell texts beyond headerWidth.
    if (!isHeader && i >= headerWidth) break;
    const text = i < cellTexts.length ? cellTexts[i]! : '';
    const alignment: Alignment =
      i < (table as TableAstNode).alignments.length
        ? (table as TableAstNode).alignments[i]!
        : null;
    const [sCell, cellId] = allocId(s);
    const cell: TableCellAstNode = {
      id: cellId,
      kind: 'table-cell',
      parentId: rowId,
      status: 'streaming',
      alignment,
      children: [],
    };
    s = appendNode(sCell, cell);
    s = appendChild(s, rowId, cellId);
    if (text.length > 0) {
      s = parseInline(s, cellId, text);
    }
    s = setStatus(s, cellId, 'complete');
  }
  s = setStatus(s, rowId, 'complete');
  return s;
}

/**
 * Split a table row line into cell texts. Respects code-span backticks so a
 * pipe inside `code` does not terminate a cell.
 */
function splitTableCells(line: string): string[] {
  // Strip leading/trailing pipes (including any whitespace).
  let inner = line.trim();
  if (inner.startsWith('|')) inner = inner.slice(1);
  if (inner.endsWith('|')) inner = inner.slice(0, -1);

  const cells: string[] = [];
  let buf = '';
  let inCode = false;
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '`') {
      // Toggle code-span state on a backtick.
      inCode = !inCode;
      buf += ch;
      i++;
      continue;
    }
    if (ch === '\\' && i + 1 < inner.length && inner[i + 1] === '|') {
      // Escaped pipe.
      buf += '|';
      i += 2;
      continue;
    }
    if (ch === '|' && !inCode) {
      cells.push(buf.trim());
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  cells.push(buf.trim());
  return cells;
}

// ── Citation definitions ──────────────────────────────────────────────────

function liftCitationDef(state: InternalState, refId: string, body: string): InternalState {
  let s = state;

  // Assign or look up the index for this id.
  const [sIdx, index] = getOrAssignCitationIndex(s, refId);
  s = sIdx;

  // Build a phantom paragraph parent so parseInline has a real node to attach to.
  // We then steal the children and discard the phantom.
  const [s1, phantomId] = allocId(s);
  const phantom: ParagraphAstNode = {
    id: phantomId,
    kind: 'paragraph',
    parentId: -1,
    status: 'complete',
    children: [],
  };
  let s2 = appendNode(s1, phantom);
  s2 = parseInline(s2, phantomId, body);
  const phantomNode = s2.nodes[phantomId];
  const childAstIds =
    phantomNode && phantomNode.kind === 'paragraph' ? phantomNode.children : [];

  // Detect duplicate.
  const existing = s2.citationDefs.get(refId);
  if (existing !== undefined) {
    s2 = pushWarning(s2, {
      code: 'duplicate_citation_def',
      index: s2.index,
      detail: `duplicate citation definition for [^${refId}]`,
    });
  }

  // Write/overwrite the def.
  const newDefs = new Map(s2.citationDefs);
  newDefs.set(refId, { id: refId, index, childAstIds, status: 'complete' });
  s2 = { ...s2, citationDefs: newDefs };

  // Flip resolved=true on existing refs for this id.
  const refsForId = s2.citationRefIds.get(refId) ?? [];
  if (refsForId.length > 0) {
    const nodes = s2.nodes.slice();
    for (const refNodeId of refsForId) {
      const n = nodes[refNodeId];
      if (n && n.kind === 'citation-reference' && !(n as CitationReferenceAstNode).resolved) {
        nodes[refNodeId] = { ...n, resolved: true } as CitationReferenceAstNode;
      }
    }
    s2 = { ...s2, nodes };
  }

  return s2;
}
