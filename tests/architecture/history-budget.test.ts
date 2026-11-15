import { describe, expect, it } from 'vitest';
import { EditorDocument } from '../../src/core/document';
import { DocumentHistory } from '../../src/core/history';

function document(revision: number, content = '文'.repeat(220)): EditorDocument {
  return EditorDocument.from({
    schemaVersion: 1,
    id: 'bounded-history-document',
    kind: 'page',
    revision,
    title: 'Bounded history',
    nodes: [
      {
        id: 'paragraph',
        type: 'element',
        tag: 'p',
        children: [{ id: 'text', type: 'text', value: content }],
      },
    ],
    css: '',
  });
}

describe('independent architecture fitness: bounded history', () => {
  it('evicts oldest snapshots by UTF-8 bytes while preserving the most recent undo/redo branch', () => {
    const first = document(0);
    const snapshotBytes = new TextEncoder().encode(JSON.stringify(first.snapshot())).byteLength;
    const history = new DocumentHistory(100, snapshotBytes * 3 + 10);
    for (let revision = 0; revision < 8; revision++) history.push(document(revision));
    expect(history.size).toBe(3);
    expect(history.retainedBytes).toBeLessThanOrEqual(snapshotBytes * 3 + 10);
    expect(history.current()?.revision).toBe(7);
    expect(history.undo()?.revision).toBe(6);
    expect(history.undo()?.revision).toBe(5);
    expect(history.undo()).toBeUndefined();
    expect(history.redo()?.revision).toBe(6);
    history.push(document(8));
    expect(history.current()?.revision).toBe(8);
    expect(history.canRedo).toBe(false);
    expect(history.undo()?.revision).toBe(6);
    expect(history.retainedBytes).toBeLessThanOrEqual(snapshotBytes * 3 + 10);
  });

  it('does not discard retained entries when a new snapshot exceeds the configured memory budget', () => {
    const history = new DocumentHistory(100, 1_024);
    history.push(document(0, 'Initial'));
    const retained = history.retainedBytes;
    expect(() => history.push(document(1, '文'.repeat(400)))).toThrow('HISTORY_SNAPSHOT_TOO_LARGE');
    expect(history.current()?.revision).toBe(0);
    expect(history.size).toBe(1);
    expect(history.retainedBytes).toBe(retained);
  });
});
