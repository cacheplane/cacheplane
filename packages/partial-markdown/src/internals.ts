// SPDX-License-Identifier: MIT
import type {
  AstNode,
  Alignment,
  InternalState,
  StreamStatus,
  MarkdownWarning,
} from './types';

// ── Regex constants ───────────────────────────────────────────────────────

/** Matches `---`, `***`, `___` (optionally separated by spaces). */
export const THEMATIC_BREAK_RE = /^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})\s*$/;

/** Matches ATX headings: capture[1] = '#'..'######', capture[2] = content. */
export const ATX_HEADING_RE = /^\s{0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;

/** Matches a fenced code block opener. capture[1] = '```' or '~~~', capture[2] = info string. */
export const FENCE_OPEN_RE = /^\s{0,3}(```|~~~)\s*([^\s`~]*)\s*$/;

/** Ordered list marker: capture[1] = digits, capture[2] = '.' or ')'. */
export const ORDERED_LIST_MARKER_RE = /^\s{0,3}(\d{1,9})([.)])\s+/;

/** Unordered list marker: capture[1] = '-' / '*' / '+'. */
export const UNORDERED_LIST_MARKER_RE = /^\s{0,3}([-*+])\s+/;

/** Blockquote prefix: matches `>` optionally followed by a space. */
export const BLOCKQUOTE_PREFIX_RE = /^\s{0,3}>\s?/;

/** Inline citation reference: [^id]. Capture[1] = id (no whitespace, no `]`). */
export const CITATION_REF_RE = /^\[\^([^\]\s]+)\]/;

/** Block-level citation definition: `[^id]: body`. Capture[1] = id, capture[2] = body. */
export const CITATION_DEF_RE = /^\[\^([^\]\s]+)\]:\s+(.*)$/;

/** Candidate table row: starts with optional whitespace, then `|`, contains `|`, ends with optional whitespace. */
export const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

/** GFM alignment row: `| :--- | :---: | ---: |` etc. */
export const TABLE_ALIGNMENT_RE =
  /^\s*\|?(?:\s*:?-+:?\s*\|)+(?:\s*:?-+:?\s*)?\s*\|?\s*$/;

/** Single alignment cell within an alignment row. Captures leading colon, trailing colon. */
export const TABLE_ALIGNMENT_CELL_RE = /^\s*(:?)-+(:?)\s*$/;

/** GFM task marker at the start of a list-item content: `[ ]`, `[x]`, or `[X]`. */
export const TASK_MARKER_RE = /^\[([ xX])\]\s+/;

/**
 * Parse an alignment row into per-column Alignment values. Returns null if
 * the row doesn't match. Cell count = number of `|`-separated cells (ignoring
 * leading/trailing pipes).
 */
export function parseAlignmentRow(line: string): ReadonlyArray<Alignment> | null {
  const trimmed = line.trim();
  if (!TABLE_ALIGNMENT_RE.test(trimmed)) return null;
  // Strip leading/trailing pipes if present.
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const cells = inner.split('|');
  const alignments: Alignment[] = [];
  for (const cell of cells) {
    const m = TABLE_ALIGNMENT_CELL_RE.exec(cell);
    if (!m) return null;
    const left = m[1] === ':';
    const right = m[2] === ':';
    if (left && right) alignments.push('center');
    else if (right) alignments.push('right');
    else if (left) alignments.push('left');
    else alignments.push(null);
  }
  return alignments;
}

// ── State helpers ─────────────────────────────────────────────────────────

export function allocId(state: InternalState): [InternalState, number] {
  const id = state.nextId;
  return [{ ...state, nextId: state.nextId + 1 }, id];
}

export function appendNode(state: InternalState, node: AstNode): InternalState {
  const nodes = [...state.nodes, node];
  return { ...state, nodes };
}

export function replaceNode(state: InternalState, id: number, node: AstNode): InternalState {
  if (state.nodes[id] === node) return state;
  const nodes = state.nodes.slice();
  nodes[id] = node;
  return { ...state, nodes };
}

export function appendChild(state: InternalState, parentId: number, childId: number): InternalState {
  const parent = state.nodes[parentId];
  if (!parent) return state;
  if (!('children' in parent)) return state;
  const updated = { ...parent, children: [...parent.children, childId] } as AstNode;
  return replaceNode(state, parentId, updated);
}

export function setStatus(
  state: InternalState,
  id: number,
  status: StreamStatus,
): InternalState {
  const node = state.nodes[id];
  if (!node) return state;
  if (node.status === status) return state;
  return replaceNode(state, id, { ...node, status });
}

export function pushWarning(state: InternalState, warning: MarkdownWarning): InternalState {
  return { ...state, warnings: [...state.warnings, warning] };
}

export function toErrorState(state: InternalState, message: string): InternalState {
  return {
    ...state,
    mode: 'error',
    error: { message, index: state.index, line: state.line, column: state.column },
  };
}

/**
 * Look up or assign the 1-based parser index for a citation id. Indices are
 * dense, in first-touch order, and shared between refs and the def for the
 * same id.
 */
// ── Line measurement ──────────────────────────────────────────────────────

export interface LineMeasurement {
  /** Column count of leading whitespace (tabs rounded up to next 4-col stop). */
  leadingCols: number;
  /** Byte index of first non-whitespace character. */
  contentStart: number;
  /** Marker info if line begins with a list marker; null otherwise. */
  marker: { ordered: boolean; start: number | null; markerEndCol: number } | null;
}

/**
 * Measure the leading indentation and optional list marker of a line.
 * Tabs are treated as advancing to the next 4-column tab stop.
 */
export function measureLine(line: string): LineMeasurement {
  let leadingCols = 0;
  let contentStart = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === ' ') {
      leadingCols++;
      contentStart = i + 1;
    } else if (ch === '\t') {
      // Round up to next 4-col tab stop.
      leadingCols = Math.floor(leadingCols / 4) * 4 + 4;
      contentStart = i + 1;
    } else {
      contentStart = i;
      break;
    }
  }

  // Detect list marker at contentStart.
  const rest = line.slice(contentStart);
  let marker: LineMeasurement['marker'] = null;

  const unord = /^([-*+]) /.exec(rest);
  if (unord) {
    marker = {
      ordered: false,
      start: null,
      markerEndCol: leadingCols + 1 + 1, // marker char + space
    };
  } else {
    const ord = /^(\d{1,9})[.)]\s/.exec(rest);
    if (ord) {
      marker = {
        ordered: true,
        start: parseInt(ord[1]!, 10),
        markerEndCol: leadingCols + ord[1]!.length + 1 + 1, // digits + punctuation + space
      };
    }
  }

  return { leadingCols, contentStart, marker };
}

export function getOrAssignCitationIndex(
  state: InternalState,
  refId: string,
): [InternalState, number] {
  const existing = state.citationIndex.get(refId);
  if (existing !== undefined) return [state, existing];
  const idx = state.nextCitationIndex;
  const next: InternalState = {
    ...state,
    citationIndex: new Map(state.citationIndex).set(refId, idx),
    nextCitationIndex: idx + 1,
  };
  return [next, idx];
}
