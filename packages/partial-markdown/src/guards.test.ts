// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import {
  isParagraphNode, isHeadingNode, isCompleteNode,
  isTableNode, isTableRowNode, isTableCellNode, isCitationReferenceNode,
} from './guards';
import { createPartialMarkdownParser } from './parser';

describe('guards', () => {
  it('isParagraphNode matches paragraph type', () => {
    const p = createPartialMarkdownParser();
    p.push('hello\n\n');
    p.finish();
    const para = p.root!.children[0];
    expect(isParagraphNode(para!)).toBe(true);
  });

  it('isHeadingNode matches heading type', () => {
    const p = createPartialMarkdownParser();
    p.push('# x\n');
    p.finish();
    const h = p.root!.children[0];
    expect(isHeadingNode(h!)).toBe(true);
  });

  it('isCompleteNode reflects status', () => {
    const p = createPartialMarkdownParser();
    p.push('hi');
    expect(isCompleteNode(p.root!)).toBe(false);
    p.finish();
    expect(isCompleteNode(p.root!)).toBe(true);
  });
});

describe('guards — new kinds', () => {
  it('isTableNode etc. discriminate', () => {
    const table: any = { type: 'table' };
    const row: any = { type: 'table-row' };
    const cell: any = { type: 'table-cell' };
    const cite: any = { type: 'citation-reference' };
    const para: any = { type: 'paragraph' };
    expect(isTableNode(table)).toBe(true);
    expect(isTableNode(para)).toBe(false);
    expect(isTableRowNode(row)).toBe(true);
    expect(isTableCellNode(cell)).toBe(true);
    expect(isCitationReferenceNode(cite)).toBe(true);
    expect(isCitationReferenceNode(para)).toBe(false);
  });
});
