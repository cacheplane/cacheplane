// SPDX-License-Identifier: MIT
import type {
  CitationDefinition,
  LinkDefinition,
  MarkdownNode,
} from './types';

interface CacheEntry {
  version: ReadonlyArray<unknown>;
  children: ReadonlyArray<unknown> | null;
  citations: SidecarMapState | null;
  linkDefinitions: SidecarMapState | null;
  value: unknown;
}

interface SidecarEntry {
  version: ReadonlyArray<unknown>;
  children: ReadonlyArray<unknown> | null;
  value: unknown;
}

interface SidecarMapState {
  entries: Map<string, SidecarEntry>;
  order: ReadonlyArray<string>;
  value: Map<string, unknown>;
}

const cache = new WeakMap<MarkdownNode, CacheEntry>();

/**
 * Produce a structurally shared, plain-object snapshot of a markdown node tree.
 * Unchanged nodes, child arrays, and document sidecars retain their references.
 * Returned snapshots are cached and should be treated as immutable.
 */
export function materialize(node: MarkdownNode | null): unknown {
  if (node === null) return null;

  const previous = cache.get(node);
  const children = reconcileChildren(getChildren(node), previous?.children ?? null);
  const citations = node.type === 'document'
    ? reconcileSidecarMap(node.citations, previous?.citations ?? null, reconcileCitation)
    : null;
  const linkDefinitions = node.type === 'document'
    ? reconcileSidecarMap(
      node.linkDefinitions,
      previous?.linkDefinitions ?? null,
      reconcileLinkDefinition,
    )
    : null;

  if (
    previous
    && nodeMatchesVersion(node, previous.version)
    && children === previous.children
    && citations === previous.citations
    && linkDefinitions === previous.linkDefinitions
  ) {
    return previous.value;
  }

  const value = createNodeSnapshot(node, children, citations, linkDefinitions);
  cache.set(node, {
    version: captureNodeVersion(node),
    children,
    citations,
    linkDefinitions,
    value,
  });

  return value;
}

function getChildren(node: MarkdownNode): ReadonlyArray<MarkdownNode> | null {
  return 'children' in node ? node.children : null;
}

function reconcileChildren(
  nodes: ReadonlyArray<MarkdownNode> | null,
  previous: ReadonlyArray<unknown> | null,
): ReadonlyArray<unknown> | null {
  if (nodes === null) return null;
  if (previous === null || previous.length !== nodes.length) {
    return nodes.map((child) => materialize(child));
  }

  let next = previous;
  for (let index = 0; index < nodes.length; index++) {
    const child = materialize(nodes[index]);
    if (child !== previous[index]) {
      if (next === previous) next = [...previous];
      (next as unknown[])[index] = child;
    }
  }

  return next;
}

function reconcileSidecarMap<T>(
  definitions: ReadonlyMap<string, T>,
  previous: SidecarMapState | null,
  reconcileEntry: (definition: T, previous: SidecarEntry | null) => SidecarEntry,
): SidecarMapState {
  if (previous === null) {
    const entries = new Map<string, SidecarEntry>();
    for (const [key, definition] of definitions) {
      entries.set(key, reconcileEntry(definition, null));
    }
    return createSidecarMapState(entries);
  }

  let entries = previous.entries;
  let changed = definitions.size !== previous.entries.size;
  let orderChanged = definitions.size !== previous.order.length;
  let index = 0;

  for (const [key, definition] of definitions) {
    if (previous.order[index] !== key) orderChanged = true;

    const previousEntry = previous.entries.get(key) ?? null;
    const nextEntry = reconcileEntry(definition, previousEntry);
    if (nextEntry !== previousEntry) {
      if (entries === previous.entries) entries = new Map(previous.entries);
      entries.set(key, nextEntry);
      changed = true;
    }
    index++;
  }

  if (definitions.size !== previous.entries.size) {
    if (entries === previous.entries) entries = new Map(previous.entries);
    for (const key of entries.keys()) {
      if (!definitions.has(key)) entries.delete(key);
    }
  }

  if (!changed && !orderChanged) return previous;

  if (orderChanged || entries.size !== definitions.size) {
    const orderedEntries = new Map<string, SidecarEntry>();
    for (const key of definitions.keys()) {
      const entry = entries.get(key);
      if (entry) orderedEntries.set(key, entry);
    }
    entries = orderedEntries;
  }

  return createSidecarMapState(entries);
}

function createSidecarMapState(entries: Map<string, SidecarEntry>): SidecarMapState {
  const value = new Map<string, unknown>();
  for (const [key, entry] of entries) value.set(key, entry.value);

  return {
    entries,
    order: [...entries.keys()],
    value,
  };
}

function reconcileCitation(
  definition: CitationDefinition,
  previous: SidecarEntry | null,
): SidecarEntry {
  const children = reconcileChildren(definition.children, previous?.children ?? null);
  if (
    previous
    && definition.id === previous.version[0]
    && definition.index === previous.version[1]
    && definition.status === previous.version[2]
    && children === previous.children
  ) {
    return previous;
  }

  return {
    version: [definition.id, definition.index, definition.status],
    children,
    value: {
      id: definition.id,
      index: definition.index,
      status: definition.status,
      children,
    },
  };
}

function reconcileLinkDefinition(
  definition: LinkDefinition,
  previous: SidecarEntry | null,
): SidecarEntry {
  if (
    previous
    && definition.id === previous.version[0]
    && definition.label === previous.version[1]
    && definition.url === previous.version[2]
    && definition.title === previous.version[3]
    && definition.status === previous.version[4]
  ) {
    return previous;
  }

  return {
    version: [
      definition.id,
      definition.label,
      definition.url,
      definition.title,
      definition.status,
    ],
    children: null,
    value: {
      id: definition.id,
      label: definition.label,
      url: definition.url,
      title: definition.title,
      status: definition.status,
    },
  };
}

function createNodeSnapshot(
  node: MarkdownNode,
  children: ReadonlyArray<unknown> | null,
  citations: SidecarMapState | null,
  linkDefinitions: SidecarMapState | null,
): unknown {
  const source = node as unknown as Record<string, unknown>;
  const value: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(source)) {
    switch (key) {
      case 'parent':
        value.parent = null;
        break;
      case 'children':
        value.children = children;
        break;
      case 'citations':
        value.citations = citations?.value;
        break;
      case 'linkDefinitions':
        value.linkDefinitions = linkDefinitions?.value;
        break;
      default:
        value[key] = cloneScalarField(field);
    }
  }

  return value;
}

function cloneScalarField(value: unknown): unknown {
  if (Array.isArray(value)) return [...value];
  if (value !== null && typeof value === 'object') {
    return { ...(value as Record<string, unknown>) };
  }
  return value;
}

function nodeMatchesVersion(node: MarkdownNode, version: ReadonlyArray<unknown>): boolean {
  if (
    node.id !== version[0]
    || node.type !== version[1]
    || node.status !== version[2]
    || node.index !== version[3]
  ) {
    return false;
  }

  switch (node.type) {
    case 'document':
    case 'paragraph':
    case 'blockquote':
    case 'emphasis':
    case 'strong':
    case 'strikethrough':
    case 'thematic-break':
    case 'soft-break':
    case 'hard-break':
      return version.length === 4;
    case 'heading':
      return node.level === version[4];
    case 'list':
      return node.ordered === version[4]
        && node.start === version[5]
        && node.tight === version[6]
        && node.markerCol === version[7]
        && node.contentCol === version[8];
    case 'list-item':
      return (node.task?.checked ?? null) === version[4];
    case 'code-block':
      return node.variant === version[4]
        && node.language === version[5]
        && node.text === version[6];
    case 'text':
    case 'inline-code':
      return node.text === version[4];
    case 'math-inline':
    case 'math-display':
      return node.text === version[4] && node.delimiter === version[5];
    case 'html-inline':
      return node.raw === version[4];
    case 'html-block':
      return node.raw === version[4] && node.htmlKind === version[5];
    case 'link':
      return node.url === version[4] && node.title === version[5];
    case 'autolink':
      return node.url === version[4] && node.text === version[5];
    case 'image':
      return node.url === version[4]
        && node.title === version[5]
        && node.alt === version[6];
    case 'table':
      return arrayMatchesVersion(node.alignments, version, 4);
    case 'table-row':
      return node.isHeader === version[4];
    case 'table-cell':
      return node.alignment === version[4];
    case 'citation-reference':
      return node.refId === version[4] && node.resolved === version[5];
    case 'link-reference':
      return node.refId === version[4]
        && node.label === version[5]
        && node.form === version[6]
        && node.resolved === version[7]
        && node.url === version[8]
        && node.title === version[9];
    default:
      return assertNever(node);
  }
}

function captureNodeVersion(node: MarkdownNode): ReadonlyArray<unknown> {
  const version: unknown[] = [node.id, node.type, node.status, node.index];

  switch (node.type) {
    case 'document':
    case 'paragraph':
    case 'blockquote':
    case 'emphasis':
    case 'strong':
    case 'strikethrough':
    case 'thematic-break':
    case 'soft-break':
    case 'hard-break':
      break;
    case 'heading':
      version.push(node.level);
      break;
    case 'list':
      version.push(node.ordered, node.start, node.tight, node.markerCol, node.contentCol);
      break;
    case 'list-item':
      version.push(node.task?.checked ?? null);
      break;
    case 'code-block':
      version.push(node.variant, node.language, node.text);
      break;
    case 'text':
    case 'inline-code':
      version.push(node.text);
      break;
    case 'math-inline':
    case 'math-display':
      version.push(node.text, node.delimiter);
      break;
    case 'html-inline':
      version.push(node.raw);
      break;
    case 'html-block':
      version.push(node.raw, node.htmlKind);
      break;
    case 'link':
      version.push(node.url, node.title);
      break;
    case 'autolink':
      version.push(node.url, node.text);
      break;
    case 'image':
      version.push(node.url, node.title, node.alt);
      break;
    case 'table':
      version.push(...node.alignments);
      break;
    case 'table-row':
      version.push(node.isHeader);
      break;
    case 'table-cell':
      version.push(node.alignment);
      break;
    case 'citation-reference':
      version.push(node.refId, node.resolved);
      break;
    case 'link-reference':
      version.push(
        node.refId,
        node.label,
        node.form,
        node.resolved,
        node.url,
        node.title,
      );
      break;
    default:
      assertNever(node);
  }

  return version;
}

function arrayMatchesVersion(
  values: ReadonlyArray<unknown>,
  version: ReadonlyArray<unknown>,
  offset: number,
): boolean {
  if (values.length !== version.length - offset) return false;
  for (let index = 0; index < values.length; index++) {
    if (values[index] !== version[offset + index]) return false;
  }
  return true;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported markdown node type: ${String(value)}`);
}
