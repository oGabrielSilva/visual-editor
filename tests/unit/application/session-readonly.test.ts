import { describe, expect, it } from 'vitest';
import { EditorFactory } from '../../../src/composition/factory';
import type { DocumentNode } from '../../../src/core/document';

const factory = new EditorFactory(() => ({
  compile: async () => {
    throw new Error('NOT_USED');
  },
}));
function paragraph(nodes: readonly DocumentNode[]): DocumentNode {
  for (const node of nodes) {
    if (node.tag === 'p') return node;
    if (node.children) {
      try {
        return paragraph(node.children);
      } catch {
        /* Continue through the fixture. */
      }
    }
  }
  throw new Error('MISSING_PARAGRAPH');
}

describe('readonly transitions and recoverable rich text', () => {
  it('invalidates pending async work on every actual transition while retaining a committable draft', () => {
    const editor = factory.create({ source: { html: '<p>Original</p>', css: '' } });
    try {
      const original = editor.session.snapshot();
      const node = paragraph(original.nodes);
      expect(editor.controller.beginRichText(node.id)).toBe(true);
      expect(editor.controller.updateRichTextDraft('Updated <strong>draft</strong>')).toBe(true);
      const before = editor.session.getState();
      const recovery = editor.controller.exportRecovery();
      editor.session.setReadOnly(true);
      const locked = editor.session.getState();
      expect(locked.editGeneration).toBe(before.editGeneration + 1);
      expect(locked.pendingRichText).toEqual({
        ...before.pendingRichText,
        editGeneration: locked.editGeneration,
      });
      expect(editor.session.commitRichText()).toBe(false);
      expect(editor.session.snapshot()).toEqual(original);
      expect(editor.session.exportSource().html).toBe('<p>Original</p>');
      expect(editor.controller.exportRecovery()).not.toBe(recovery);
      editor.session.setReadOnly(true);
      expect(editor.session.getState().editGeneration).toBe(locked.editGeneration);
      editor.session.setReadOnly(false);
      const unlocked = editor.session.getState();
      expect(unlocked.editGeneration).toBe(locked.editGeneration + 1);
      expect(unlocked.pendingRichText?.editGeneration).toBe(unlocked.editGeneration);
      expect(editor.session.commitRichText()).toBe(true);
      expect(editor.session.exportSource().html).toContain('Updated <strong>draft</strong>');
      expect(editor.session.undo()).toBe(true);
      expect(editor.session.exportSource().html).toBe('<p>Original</p>');
    } finally {
      editor.dispose();
    }
  });

  it('keeps an unsafe pending buffer inert and recoverable through readonly transitions', () => {
    const editor = factory.create({ source: { html: '<p>Original</p>', css: '' } });
    try {
      const before = editor.session.snapshot();
      const node = paragraph(before.nodes);
      expect(editor.controller.beginRichText(node.id)).toBe(true);
      const unsafe = '<img src="https://example.com/image.png" onerror="bad()">';
      expect(editor.controller.updateRichTextDraft(unsafe)).toBe(false);
      editor.session.setReadOnly(true);
      editor.session.setReadOnly(false);
      const state = editor.session.getState();
      expect(state.pendingRichText).toMatchObject({
        html: unsafe,
        changed: true,
        valid: false,
        editGeneration: state.editGeneration,
      });
      expect(editor.session.commitRichText()).toBe(false);
      expect(editor.session.snapshot()).toEqual(before);
      expect(editor.controller.exportRecovery()).toContain('onerror');
      expect(editor.session.getState().canUndo).toBe(false);
    } finally {
      editor.dispose();
    }
  });
});
