// SPDX-License-Identifier: MIT

const sourceImplementations = new Set([
  'events',
  'final-materialize',
  'materialize-each',
]);

const preparedImplementations = new Set([
  'unchanged',
  'leaf-change',
  'citation-change',
]);

/**
 * Creates an import-safe Markdown source benchmark invocation.
 *
 * @param {{ createPartialMarkdownParser: Function, materialize: Function }} module Loaded partial-Markdown module.
 * @param {string} implementation Source scenario implementation.
 * @param {string[]} chunks Effective Markdown input chunks.
 * @returns {() => unknown} Benchmark invocation.
 */
export function createSourceRun(module, implementation, chunks) {
  if (!sourceImplementations.has(implementation)) {
    throw new Error(`Unknown Markdown source implementation: ${implementation}`);
  }

  return () => {
    const parser = module.createPartialMarkdownParser();

    for (const chunk of chunks) {
      parser.push(chunk);
      if (implementation === 'materialize-each' && parser.root) {
        module.materialize(parser.root);
      }
    }
    parser.finish();

    if (implementation === 'events') return parser.root;
    return module.materialize(parser.root);
  };
}

/**
 * Creates an import-safe prepared Markdown materialization benchmark invocation.
 *
 * @param {{ createPartialMarkdownParser: Function, materialize: Function }} module Loaded partial-Markdown module.
 * @param {string} implementation Prepared scenario implementation.
 * @param {{ input: string }} workload Markdown workload to parse once.
 * @returns {() => unknown} Benchmark invocation.
 */
export function createPreparedMaterializeRun(module, implementation, workload) {
  if (!preparedImplementations.has(implementation)) {
    throw new Error(`Unknown prepared Markdown implementation: ${implementation}`);
  }

  const parser = module.createPartialMarkdownParser();
  parser.push(workload.input);
  parser.finish();

  let root = parser.root;
  if (!root) throw new Error('Prepared Markdown workload did not produce a document root');

  if (implementation === 'unchanged') {
    module.materialize(root);
    return () => module.materialize(root);
  }

  if (implementation === 'leaf-change') {
    const textLeaf = findTextLeaf(root);
    if (!textLeaf) throw new Error('Prepared Markdown workload has no mutable text leaf');
    const original = textLeaf.text;
    const alternate = createEqualLengthVariant(original);
    let useAlternate = true;

    module.materialize(root);
    return () => {
      textLeaf.text = useAlternate ? alternate : original;
      useAlternate = !useAlternate;
      return module.materialize(root);
    };
  }

  const target = findCitationTextTarget(root.citations);
  if (!target) {
    throw new Error('Prepared Markdown workload has no citation-body text leaf');
  }
  const original = target.textLeaf.text;
  const alternate = createEqualLengthVariant(original);
  let useAlternate = true;

  module.materialize(root);
  return () => {
    const definition = root.citations.get(target.citationId);
    if (!definition) throw new Error('Prepared Markdown citation mutation target disappeared');

    target.textLeaf.text = useAlternate ? alternate : original;
    const citations = new Map(root.citations);
    citations.set(target.citationId, {
      ...definition,
    });
    root = {
      ...root,
      citations,
      linkDefinitions: root.linkDefinitions,
    };
    useAlternate = !useAlternate;
    return module.materialize(root);
  };
}

function findTextLeaf(node) {
  if (node.type === 'text' && node.text.length > 0) return node;
  if (!Array.isArray(node.children)) return null;

  for (const child of node.children) {
    const match = findTextLeaf(child);
    if (match) return match;
  }
  return null;
}

function findCitationTextTarget(citations) {
  for (const [citationId, definition] of citations) {
    const textLeaf = findTextLeaf(definition);
    if (textLeaf) return { citationId, textLeaf };
  }
  return null;
}

function createEqualLengthVariant(input) {
  for (let index = 0; index < input.length; index += 1) {
    const codeUnit = input.charCodeAt(index);
    if (codeUnit < 0xD800 || codeUnit > 0xDFFF) {
      const replacement = input[index] === 'a' ? 'b' : 'a';
      return `${input.slice(0, index)}${replacement}${input.slice(index + 1)}`;
    }
  }
  throw new Error('Prepared Markdown text leaf has no equal-length mutation');
}
