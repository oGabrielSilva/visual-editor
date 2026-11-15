import { describe, expect, it } from 'vitest';
import { createEditor } from '../../../src/composition/browser';

describe('inert recovery of pending HTML', () => {
  it('reimports an invalid buffer without replacing or executing the valid preview', async () => {
    const original = createEditor({
      kind: 'page',
      source: { html: '<h1>Safe saved content</h1>', css: '' },
    });
    original.controller.setMode('html');
    // Only a buffer over the limits is invalid now; a script is kept in a page.
    original.controller.setDraft('html', `<h1>Pending text</h1>${'<div>'.repeat(300)}deep`);
    const recovery = original.controller.exportRecovery();
    const reopened = createEditor({ kind: 'page' });
    expect(
      await reopened.controller.importFile(
        new File([recovery], 'recovery.json', { type: 'application/json' }),
      ),
    ).toBe(true);
    expect(reopened.session.getState().mode).toBe('html');
    expect(reopened.session.getState().draftSource.html).toContain('Pending text');
    expect(reopened.controller.previewHtml()).toContain('Safe saved content');
    expect(reopened.controller.previewHtml()).not.toContain('Pending text');
    expect(reopened.controller.setMode('visual')).toBe(false);
    reopened.controller.discardDraft();
    expect(reopened.controller.setMode('visual')).toBe(true);
    original.dispose();
    reopened.dispose();
  });

  it('rejects a recovery document which is not a sound document atomically', async () => {
    const editor = createEditor({
      kind: 'page',
      source: { html: '<h1>Keep original</h1>', css: '' },
    });
    const before = editor.session.snapshot();
    const forged = {
      ...before,
      // A script alone no longer refuses a page; a subtree inside one is not a document.
      nodes: [
        {
          id: 'script',
          type: 'element',
          tag: 'script',
          children: [{ id: 'inner', type: 'element', tag: 'b', children: [] }],
        },
      ],
    };
    const recovery = {
      format: 'visual-editor-recovery-v1',
      document: forged,
      pendingSource: { html: '<p>pending</p>', css: '' },
    };
    expect(
      await editor.controller.importFile(new File([JSON.stringify(recovery)], 'recovery.json')),
    ).toBe(false);
    expect(editor.session.snapshot()).toEqual(before);
    editor.dispose();
  });
});
