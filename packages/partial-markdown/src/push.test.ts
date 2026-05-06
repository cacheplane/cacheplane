// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { pushInternal } from './push';
import { createInternal } from './create';

describe('pushInternal — line buffering', () => {
  it('buffers a partial line that has no terminating newline', () => {
    const s0 = createInternal();
    const s1 = pushInternal(s0, 'partial line');
    expect(s1.lineBuffer).toBe('partial line');
    expect(s1.nodes).toHaveLength(1); // document root only
  });

  it('flushes a buffered line when a newline arrives in a later push', () => {
    let s = createInternal();
    s = pushInternal(s, 'partial');
    s = pushInternal(s, ' line\n');
    expect(s.lineBuffer).toBe('');
  });

  it('handles multiple newlines in one chunk', () => {
    let s = createInternal();
    s = pushInternal(s, 'a\nb\nc\n');
    expect(s.lineBuffer).toBe('');
  });

  it('lazily creates the document root on first push', () => {
    const s0 = createInternal();
    expect(s0.rootId).toBeNull();
    const s1 = pushInternal(s0, 'x');
    expect(s1.rootId).toBe(0);
    expect(s1.nodes[0]?.kind).toBe('document');
  });

  it('does nothing on an empty chunk', () => {
    const s0 = createInternal();
    const s1 = pushInternal(s0, '');
    expect(s1).toBe(s0);
  });
});
