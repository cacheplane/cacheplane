// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { createInternal } from './create';

describe('createInternal', () => {
  it('returns an empty state in block mode with no nodes', () => {
    const s = createInternal();
    expect(s.nodes).toEqual([]);
    expect(s.rootId).toBeNull();
    expect(s.error).toBeNull();
    expect(s.warnings).toEqual([]);
    expect(s.complete).toBe(false);
  });

  it('initializes parser cursors at line 1, column 1', () => {
    const s = createInternal();
    expect(s.index).toBe(0);
    expect(s.line).toBe(1);
    expect(s.column).toBe(1);
  });

  it('starts in block mode with empty stack and no current node', () => {
    const s = createInternal();
    expect(s.mode).toBe('block');
    expect(s.stack).toEqual([]);
    expect(s.currentNodeId).toBeNull();
  });

  it('initializes empty line and text buffers', () => {
    const s = createInternal();
    expect(s.lineBuffer).toBe('');
    expect(s.textBuffer).toBe('');
  });

  it('starts the id allocator at 0', () => {
    const s = createInternal();
    expect(s.nextId).toBe(0);
  });

  it('enables both math delimiter families by default', () => {
    const s = createInternal();
    expect(s.options.math).toEqual({ dollar: true, bracket: true });
  });

  it('accepts math delimiter family options', () => {
    const s = createInternal({ math: { dollar: false, bracket: false } });
    expect(s.options.math).toEqual({ dollar: false, bracket: false });
  });

  it('initializes HTML parser state fields', () => {
    const s = createInternal();
    expect(s.htmlBlockKind).toBeNull();
    expect(s.htmlBlockNodeId).toBeNull();
    expect(s.htmlInlinePending).toBe('');
  });
});
