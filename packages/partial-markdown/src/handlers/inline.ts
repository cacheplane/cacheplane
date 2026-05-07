// SPDX-License-Identifier: MIT
import type {
  InternalState,
  AstNode,
  TextAstNode,
  EmphasisAstNode,
  StrongAstNode,
  StrikethroughAstNode,
  InlineCodeAstNode,
  MathInlineAstNode,
  HtmlInlineAstNode,
  LinkAstNode,
  AutolinkAstNode,
  ImageAstNode,
  CitationReferenceAstNode,
  LinkReferenceAstNode,
} from '../types';
import {
  allocId,
  appendNode,
  appendChild,
  CITATION_REF_RE,
  getOrAssignCitationIndex,
  LINK_REF_COLLAPSED_RE,
  LINK_REF_FULL_RE,
  LINK_REF_SHORTCUT_RE,
  normalizeLinkLabel,
} from '../internals';
import { findMathCloser, inlineDelimiter, isMathOpenerAt, openerLength } from './math';
import { matchInlineHtml } from './html';

/**
 * Parse a single line of inline content into AST nodes attached as children
 * of `parentId`. Returns the updated state.
 *
 * Algorithm: a left-to-right scan with explicit token recognition.
 * Emphasis/strong/strikethrough are matched as paired runs of identical
 * characters (`*` / `_` / `~`). Inline code is matched by counting
 * backticks. Links and images by `[…](…)` patterns. Autolinks by
 * `<scheme://…>`. Unmatched delimiters become literal text.
 */
export function parseInline(state: InternalState, parentId: number, line: string): InternalState {
  let s = state;
  const cursor = { i: 0 };

  while (cursor.i < line.length) {
    const ch = line[cursor.i];
    if (ch == null) break;

    // Inline code
    if (ch === '`') {
      const result = matchInlineCode(line, cursor.i);
      if (result) {
        s = appendInlineNode(s, parentId, makeInlineCode(s, parentId, result.text));
        cursor.i = result.endIndex;
        continue;
      }
    }

    // Inline math: $..$ and \(..\). Code spans above remain opaque.
    if (ch === '$' || ch === '\\') {
      const opener = isMathOpenerAt(line, cursor.i, s.options.math);
      if (opener && (opener.kind === '$' || opener.kind === '\\(')) {
        const bodyStart = cursor.i + openerLength(opener.kind);
        const closer = findMathCloser(line, bodyStart, opener.kind);
        if (closer >= 0) {
          s = appendInlineNode(
            s,
            parentId,
            makeMathInline(s, parentId, line.slice(bodyStart, closer), opener.kind),
          );
          cursor.i = closer + openerLength(opener.kind);
          continue;
        }
      }
    }

    // Emphasis / strong / strikethrough
    if (ch === '*' || ch === '_' || ch === '~') {
      const result = matchPairedRun(line, cursor.i, ch);
      if (result) {
        // Recursively parse the inner content via a phantom parent.
        const inner = parsedInner(s, line.slice(result.contentStart, result.contentEnd));
        const built = makePairedNode(inner.state, parentId, ch, result.runLength, inner.childIds);
        s = appendInlineNode(built.state, parentId, built);
        cursor.i = result.endIndex;
        continue;
      }
    }

    // Image: ![alt](url "title?")
    if (ch === '!' && line[cursor.i + 1] === '[') {
      const result = matchLinkOrImage(line, cursor.i + 1);
      if (result) {
        s = appendInlineNode(s, parentId, makeImage(s, parentId, result.text, result.url, result.title));
        cursor.i = result.endIndex;
        continue;
      }
    }

    // Citation reference: [^id] (must precede the link `[` matcher).
    if (ch === '[' && line[cursor.i + 1] === '^') {
      const m = CITATION_REF_RE.exec(line.slice(cursor.i));
      if (m) {
        const refId = m[1]!;
        const [sIdx, index] = getOrAssignCitationIndex(s, refId);
        s = sIdx;
        const [s1, citeId] = allocId(s);
        const existingDef = s1.citationDefs.get(refId);
        const cite: CitationReferenceAstNode = {
          id: citeId,
          kind: 'citation-reference',
          parentId,
          status: 'complete',
          refId,
          index,
          resolved: existingDef !== undefined,
        };
        let s2 = appendNode(s1, cite);
        s2 = appendChild(s2, parentId, citeId);
        // Track this ref in the registry so backward defs can flip resolved.
        const refsForId = s2.citationRefIds.get(refId) ?? [];
        s2 = {
          ...s2,
          citationRefIds: new Map(s2.citationRefIds).set(refId, [...refsForId, citeId]),
        };
        s = s2;
        cursor.i += m[0].length;
        continue;
      }
    }

    // Link: [text](url "title?")
    if (ch === '[') {
      const result = matchLinkOrImage(line, cursor.i);
      if (result) {
        const inner = parsedInner(s, result.text);
        const built = makeLink(inner.state, parentId, result.url, result.title, inner.childIds);
        s = appendInlineNode(built.state, parentId, built);
        cursor.i = result.endIndex;
        continue;
      }

      const linkRef = matchLinkReference(line.slice(cursor.i));
      if (linkRef) {
        const built = makeLinkReference(s, parentId, linkRef.text, linkRef.label, linkRef.form);
        s = appendInlineNode(built.state, parentId, built);
        cursor.i += linkRef.length;
        continue;
      }
    }

    // Inline HTML. Autolink below remains separate and HTML rejects URL forms.
    if (ch === '<') {
      const result = matchInlineHtml(line, cursor.i);
      if (result && result !== 'pending') {
        const raw = line.slice(cursor.i, cursor.i + result.length);
        s = appendInlineNode(s, parentId, makeHtmlInline(s, parentId, raw));
        cursor.i += result.length;
        continue;
      }
    }

    // Autolink: <scheme://...>
    if (ch === '<') {
      const result = matchAutolink(line, cursor.i);
      if (result) {
        s = appendInlineNode(s, parentId, makeAutolink(s, parentId, result.url));
        cursor.i = result.endIndex;
        continue;
      }
    }

    // Plain text run.
    const textRun = matchTextRun(line, cursor.i);
    s = appendInlineNode(s, parentId, makeText(s, parentId, textRun.text));
    cursor.i = textRun.endIndex;
  }

  return s;
}

// ── Token matchers (return null when no match) ─────────────────────────────

function matchInlineCode(line: string, start: number): { text: string; endIndex: number } | null {
  let i = start;
  while (i < line.length && line[i] === '`') i++;
  const tickCount = i - start;
  let j = i;
  while (j < line.length) {
    if (line[j] === '`') {
      let k = j;
      while (k < line.length && line[k] === '`') k++;
      const closerCount = k - j;
      if (closerCount === tickCount) {
        return { text: line.slice(i, j), endIndex: k };
      }
      j = k;
    } else {
      j++;
    }
  }
  return null;
}

function matchPairedRun(
  line: string, start: number, ch: string,
): { contentStart: number; contentEnd: number; endIndex: number; runLength: number } | null {
  let i = start;
  while (i < line.length && line[i] === ch) i++;
  const runLength = i - start;
  if (ch === '~' && runLength !== 2) return null;
  if ((ch === '*' || ch === '_') && runLength > 2) return null;

  let j = i;
  while (j < line.length) {
    if (line[j] === ch) {
      let k = j;
      while (k < line.length && line[k] === ch) k++;
      if (k - j === runLength) {
        return { contentStart: i, contentEnd: j, endIndex: k, runLength };
      }
      j = k;
    } else {
      j++;
    }
  }
  return null;
}

function matchLinkOrImage(line: string, start: number): {
  text: string; url: string; title: string; endIndex: number;
} | null {
  if (line[start] !== '[') return null;
  let depth = 1;
  let i = start + 1;
  while (i < line.length && depth > 0) {
    if (line[i] === '[') depth++;
    else if (line[i] === ']') depth--;
    if (depth === 0) break;
    i++;
  }
  if (depth !== 0) return null;
  const text = line.slice(start + 1, i);
  if (line[i + 1] !== '(') return null;
  let j = i + 2;
  let url = '';
  while (j < line.length && line[j] !== ' ' && line[j] !== ')' && line[j] !== '\t') {
    url += line[j];
    j++;
  }
  let title = '';
  if (line[j] === ' ' || line[j] === '\t') {
    while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j++;
    if (line[j] === '"') {
      j++;
      while (j < line.length && line[j] !== '"') {
        title += line[j];
        j++;
      }
      if (line[j] === '"') j++;
    }
  }
  if (line[j] !== ')') return null;
  return { text, url, title, endIndex: j + 1 };
}

function matchAutolink(line: string, start: number): { url: string; endIndex: number } | null {
  if (line[start] !== '<') return null;
  let i = start + 1;
  let url = '';
  while (i < line.length && line[i] !== '>') {
    url += line[i];
    i++;
  }
  if (line[i] !== '>') return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return null;
  return { url, endIndex: i + 1 };
}

function matchTextRun(line: string, start: number): { text: string; endIndex: number } {
  let i = start;
  let text = '';
  while (i < line.length) {
    const c = line[i];
    if (
      c === '*' || c === '_' || c === '~' || c === '`' || c === '[' ||
      c === '<' || c === '!' || c === '$' ||
      (c === '\\' && (line[i + 1] === '(' || line[i + 1] === '['))
    ) break;
    text += c;
    i++;
  }
  if (i === start) {
    text = line[start] ?? '';
    i = start + 1;
  }
  return { text, endIndex: i };
}

// ── Node factories ─────────────────────────────────────────────────────────

interface NodeBuild {
  state: InternalState;
  node: AstNode;
}

function makeText(state: InternalState, parentId: number, text: string): NodeBuild {
  const [s1, id] = allocId(state);
  const node: TextAstNode = { id, kind: 'text', parentId, status: 'complete', text };
  return { state: s1, node };
}

function makeInlineCode(state: InternalState, parentId: number, text: string): NodeBuild {
  const [s1, id] = allocId(state);
  const node: InlineCodeAstNode = { id, kind: 'inline-code', parentId, status: 'complete', text };
  return { state: s1, node };
}

function makeMathInline(
  state: InternalState,
  parentId: number,
  text: string,
  kind: '$' | '\\(',
): NodeBuild {
  const [s1, id] = allocId(state);
  const node: MathInlineAstNode = {
    id,
    kind: 'math-inline',
    parentId,
    status: 'complete',
    text,
    delimiter: inlineDelimiter(kind),
  };
  return { state: s1, node };
}

function makeHtmlInline(state: InternalState, parentId: number, raw: string): NodeBuild {
  const [s1, id] = allocId(state);
  const node: HtmlInlineAstNode = {
    id,
    kind: 'html-inline',
    parentId,
    status: 'complete',
    raw,
  };
  return { state: s1, node };
}

function makeAutolink(state: InternalState, parentId: number, url: string): NodeBuild {
  const [s1, id] = allocId(state);
  const node: AutolinkAstNode = { id, kind: 'autolink', parentId, status: 'complete', url, text: url };
  return { state: s1, node };
}

function makeImage(state: InternalState, parentId: number, alt: string, url: string, title: string): NodeBuild {
  const [s1, id] = allocId(state);
  const node: ImageAstNode = { id, kind: 'image', parentId, status: 'complete', url, title, alt };
  return { state: s1, node };
}

function makeLink(
  state: InternalState, parentId: number, url: string, title: string, childIds: number[],
): NodeBuild {
  const [s1, id] = allocId(state);
  const node: LinkAstNode = { id, kind: 'link', parentId, status: 'complete', url, title, children: childIds };
  let s = appendNode(s1, node);
  // Re-parent the children IDs to the new link node.
  for (const cid of childIds) {
    const child = s.nodes[cid];
    if (child) {
      const updated = { ...child, parentId: id } as AstNode;
      const nodes = s.nodes.slice();
      nodes[cid] = updated;
      s = { ...s, nodes };
    }
  }
  return { state: s, node };
}

function makeLinkReference(
  state: InternalState,
  parentId: number,
  text: string,
  label: string,
  form: 'full' | 'collapsed' | 'shortcut',
): NodeBuild {
  const refId = normalizeLinkLabel(label);
  const existingDef = state.linkDefs.get(refId);

  const [s1, refNodeId] = allocId(state);
  const [s2, textNodeId] = allocId(s1);
  const node: LinkReferenceAstNode = {
    id: refNodeId,
    kind: 'link-reference',
    parentId,
    status: existingDef ? 'complete' : 'streaming',
    refId,
    label,
    form,
    children: [textNodeId],
    resolved: existingDef !== undefined,
    url: existingDef?.url ?? '',
    title: existingDef?.title ?? '',
  };
  const textNode: TextAstNode = {
    id: textNodeId,
    kind: 'text',
    parentId: refNodeId,
    status: 'complete',
    text,
  };
  let s = appendNode(s2, node);
  s = appendNode(s, textNode);

  const refsForId = s.linkRefIds.get(refId) ?? [];
  s = {
    ...s,
    linkRefIds: new Map(s.linkRefIds).set(refId, existingDef ? refsForId : [...refsForId, refNodeId]),
  };

  return { state: s, node };
}

function makePairedNode(
  state: InternalState, parentId: number, ch: string, runLength: number, childIds: number[],
): NodeBuild {
  const [s1, id] = allocId(state);
  let node: AstNode;
  if (ch === '~') {
    node = { id, kind: 'strikethrough', parentId, status: 'complete', children: childIds } as StrikethroughAstNode;
  } else if (runLength === 2) {
    node = { id, kind: 'strong', parentId, status: 'complete', children: childIds } as StrongAstNode;
  } else {
    node = { id, kind: 'emphasis', parentId, status: 'complete', children: childIds } as EmphasisAstNode;
  }
  let s = appendNode(s1, node);
  for (const cid of childIds) {
    const child = s.nodes[cid];
    if (child) {
      const updated = { ...child, parentId: id } as AstNode;
      const nodes = s.nodes.slice();
      nodes[cid] = updated;
      s = { ...s, nodes };
    }
  }
  return { state: s, node };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function appendInlineNode(state: InternalState, parentId: number, build: NodeBuild): InternalState {
  let s = build.state;
  // Some factories already append (link/strong/emphasis/strikethrough);
  // others (text/inline-code/autolink/image) don't yet.
  if (s.nodes[build.node.id] !== build.node) {
    s = appendNode(s, build.node);
  }
  return appendChild(s, parentId, build.node.id);
}

interface InlineParse {
  state: InternalState;
  childIds: number[];
}

function parsedInner(state: InternalState, content: string): InlineParse {
  // Allocate a phantom paragraph as the temporary parent. The phantom is
  // never linked into the document (no parentId reference, no children
  // entry on a real container), it just collects the children IDs we
  // hand back to the real caller.
  const [s1, phantomId] = allocId(state);
  let s = appendNode(s1, {
    id: phantomId, kind: 'paragraph', parentId: -1, status: 'complete', children: [],
  });
  s = parseInline(s, phantomId, content);
  const phantom = s.nodes[phantomId];
  const childIds = (phantom && 'children' in phantom) ? phantom.children : [];
  return { state: s, childIds };
}

function matchLinkReference(remainder: string): {
  text: string;
  label: string;
  form: 'full' | 'collapsed' | 'shortcut';
  length: number;
} | null {
  const full = LINK_REF_FULL_RE.exec(remainder);
  if (full) {
    return { text: full[1]!, label: full[2]!, form: 'full', length: full[0].length };
  }
  const collapsed = LINK_REF_COLLAPSED_RE.exec(remainder);
  if (collapsed) {
    return { text: collapsed[1]!, label: collapsed[1]!, form: 'collapsed', length: collapsed[0].length };
  }
  const shortcut = LINK_REF_SHORTCUT_RE.exec(remainder);
  if (shortcut) {
    return { text: shortcut[1]!, label: shortcut[1]!, form: 'shortcut', length: shortcut[0].length };
  }
  return null;
}
