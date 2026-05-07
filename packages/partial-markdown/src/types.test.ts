// SPDX-License-Identifier: MIT
import { describe, it, expectTypeOf } from 'vitest';
import type {
  MarkdownNode,
  MarkdownDocumentNode,
  MarkdownParagraphNode,
  MarkdownTextNode,
  StreamStatus,
  ParseEvent,
  PartialMarkdownParser,
  StreamState,
  InternalState,
  AstNodeKind,
  ParseMode,
} from './types';

describe('types', () => {
  it('StreamStatus is a tristate', () => {
    expectTypeOf<StreamStatus>().toEqualTypeOf<'pending' | 'streaming' | 'complete'>();
  });

  it('MarkdownDocumentNode is a MarkdownNode', () => {
    expectTypeOf<MarkdownDocumentNode>().toMatchTypeOf<MarkdownNode>();
  });

  it('MarkdownParagraphNode children are inline nodes', () => {
    type Children = MarkdownParagraphNode['children'];
    expectTypeOf<Children[number]>().toMatchTypeOf<MarkdownNode>();
  });

  it('MarkdownTextNode has a mutable text field', () => {
    expectTypeOf<MarkdownTextNode['text']>().toEqualTypeOf<string>();
  });

  it('ParseEvent carries a node and an optional delta', () => {
    expectTypeOf<ParseEvent>().toMatchTypeOf<{ type: string; node: MarkdownNode; delta?: string }>();
  });

  it('PartialMarkdownParser.push returns ParseEvent[]', () => {
    type Push = PartialMarkdownParser['push'];
    expectTypeOf<Push>().toEqualTypeOf<(chunk: string) => ParseEvent[]>();
  });

  it('InternalState extends StreamState', () => {
    expectTypeOf<InternalState>().toMatchTypeOf<StreamState>();
  });

  it('AstNodeKind covers all markdown node types', () => {
    type Kinds = AstNodeKind;
    expectTypeOf<Kinds>().toEqualTypeOf<
      | 'document'
      | 'paragraph'
      | 'heading'
      | 'blockquote'
      | 'list'
      | 'list-item'
      | 'code-block'
      | 'thematic-break'
      | 'text'
      | 'emphasis'
      | 'strong'
      | 'strikethrough'
      | 'inline-code'
      | 'link'
      | 'autolink'
      | 'image'
      | 'soft-break'
      | 'hard-break'
      | 'table'
      | 'table-row'
      | 'table-cell'
      | 'citation-reference'
      | 'link-reference'
      | 'math-inline'
      | 'math-display'
    >();
  });

  it('ParseMode is a closed union', () => {
    expectTypeOf<ParseMode>().toEqualTypeOf<
      | 'block'
      | 'paragraph'
      | 'heading'
      | 'blockquote'
      | 'list-item'
      | 'code-fence'
      | 'code-indented'
      | 'inline'
      | 'table'
      | 'table-row'
      | 'citation-def'
      | 'link-def-title'
      | 'math-inline'
      | 'math-display'
      | 'done'
      | 'error'
    >();
  });
});
