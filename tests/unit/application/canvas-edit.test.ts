import { describe, expect, it } from 'vitest';
import { EditorFactory } from '../../../src/composition/factory';
import type { DocumentNode, EditorDocumentData } from '../../../src/core/document';
import { DocumentBudget } from '../../../src/core/budget';
import type { EditorState } from '../../../src/application/session';

const factory = new EditorFactory(() => ({
  compile: async () => {
    throw new Error('NOT_USED');
  },
}));
function find(
  nodes: readonly DocumentNode[],
  predicate: (node: DocumentNode) => boolean,
): DocumentNode {
  for (const node of nodes) {
    if (predicate(node)) return node;
    try {
      return find(node.children ?? [], predicate);
    } catch {
      /* Search the next subtree. */
    }
  }
  throw new Error('MISSING_FIXTURE_NODE');
}

describe('one rich text transaction per canvas gesture', () => {
  it('keeps typing temporary, marks it dirty and flushes the final value through direct host save', async () => {
    const saved: { document: EditorDocumentData; html: string }[] = [];
    const editor = factory.create({
      source: { html: '<h1>Original</h1>', css: '' },
      host: {
        store: {
          save: async (document, source) => {
            saved.push({ document, html: source.html });
            return { revision: 1 };
          },
        },
      },
    });
    try {
      const id = find(editor.session.snapshot().nodes, (node) => node.tag === 'h1').id;
      const before = editor.session.snapshot();
      expect(editor.controller.beginRichText(id)).toBe(true);
      expect(editor.controller.updateRichTextDraft('<p>First</p>')).toBe(true);
      expect(editor.controller.updateRichTextDraft('<p>Final <strong>value</strong></p>')).toBe(
        true,
      );
      expect(editor.session.snapshot()).toEqual(before);
      expect(editor.session.getState()).toMatchObject({
        dirty: true,
        canUndo: true,
        pendingRichText: { changed: true, valid: true },
      });
      expect(editor.session.exportSource().html).toBe('<h1>Original</h1>');
      expect(await editor.session.save()).toBe(true);
      expect(saved).toHaveLength(1);
      expect(saved[0]?.html).toBe('<h1>Final <strong>value</strong></h1>');
      expect(editor.session.getState()).toMatchObject({
        dirty: false,
        document: { revision: before.revision + 1 },
      });
      expect(editor.session.getState().pendingRichText).toBeUndefined();
      expect(editor.controller.undo()).toBe(true);
      expect(editor.session.exportSource().html).toBe('<h1>Original</h1>');
      expect(editor.controller.undo()).toBe(false);
      expect(editor.controller.redo()).toBe(true);
      expect(editor.session.exportSource().html).toContain('Final');
    } finally {
      editor.dispose();
    }
  });

  it('undoes pending typing as a whole and flushes before switching to HTML or export', () => {
    const editor = factory.create({ source: { html: '<p>Original</p>', css: '' } });
    try {
      const id = find(editor.session.snapshot().nodes, (node) => node.tag === 'p').id;
      expect(editor.controller.beginRichText(id)).toBe(true);
      editor.controller.updateRichTextDraft('<p>Typing</p>');
      expect(editor.session.undo()).toBe(true);
      expect(editor.session.exportSource().html).toBe('<p>Original</p>');
      expect(editor.controller.beginRichText(id)).toBe(true);
      editor.controller.updateRichTextDraft('<p>Switch</p>');
      expect(editor.controller.setMode('html')).toBe(true);
      expect(editor.session.getState().draftSource.html).toBe('<p>Switch</p>');
      expect(editor.controller.setMode('visual')).toBe(true);
      expect(editor.controller.beginRichText(id)).toBe(true);
      editor.controller.updateRichTextDraft('<p>Export</p>');
      expect(editor.controller.exportSource().html).toBe('<p>Export</p>');
      expect(JSON.parse(editor.controller.exportJson()).revision).toBeGreaterThan(0);
    } finally {
      editor.dispose();
    }
  });

  it('preserves a pending buffer when readonly is activated and refuses host writes', async () => {
    const editor = factory.create({ source: { html: '<p>Original</p>', css: '' } });
    try {
      const id = find(editor.session.snapshot().nodes, (node) => node.tag === 'p').id;
      editor.controller.beginRichText(id);
      editor.controller.updateRichTextDraft('<p>Keep pending</p>');
      editor.session.setReadOnly(true);
      expect(await editor.session.save()).toBe(false);
      expect(editor.controller.commitRichText()).toBe(false);
      expect(editor.session.getState().pendingRichText?.html).toBe('<p>Keep pending</p>');
      expect(editor.session.exportSource().html).toBe('<p>Original</p>');
      editor.session.setReadOnly(false);
      expect(editor.controller.commitRichText()).toBe(true);
      expect(editor.session.exportSource().html).toBe('<p>Keep pending</p>');
    } finally {
      editor.dispose();
    }
  });

  it('rejects unsafe initial projections and keeps prohibited drafts recoverable without exposing them', async () => {
    const editor = factory.create({ source: { html: '<h1>Safe</h1>', css: '' } });
    const reopened = factory.create({ kind: 'page' });
    try {
      const id = find(editor.session.snapshot().nodes, (node) => node.tag === 'h1').id;
      expect(
        editor.session.beginRichText(id, '<p style="position:fixed">Unsafe host projection</p>'),
      ).toBe(false);
      expect(editor.session.getState().pendingRichText).toBeUndefined();
      expect(editor.controller.beginRichText(id)).toBe(true);
      const invalid = '<p>Keep this buffer</p><script>steal()</script>';
      expect(editor.controller.updateRichTextDraft(invalid)).toBe(false);
      expect(editor.session.getState().pendingRichText).toMatchObject({
        html: invalid,
        valid: false,
        changed: true,
      });
      expect(editor.controller.richTextFor(id)).toBe('<p>Safe</p>');
      expect(editor.controller.commitRichText()).toBe(false);
      expect(editor.controller.setMode('html')).toBe(false);
      expect(editor.session.exportSource().html).toBe('<h1>Safe</h1>');
      const recovery = editor.controller.exportRecovery();
      expect(await reopened.controller.importFile(new File([recovery], 'recovery.json'))).toBe(
        true,
      );
      expect(reopened.session.getState().pendingRichText).toMatchObject({
        html: invalid,
        valid: false,
      });
      expect(reopened.controller.richTextFor(id)).toBe('<p>Safe</p>');
      expect(reopened.controller.previewHtml()).not.toContain('<script>');
      reopened.controller.cancelRichText();
      expect(reopened.session.getState().pendingRichText).toBeUndefined();
    } finally {
      editor.dispose();
      reopened.dispose();
    }
  });

  it('blocks save/export after an oversized attempt, retains only the bounded buffer and recovers the block', async () => {
    const editor = factory.create({ source: { html: '<p>Original</p>', css: '' } });
    const reopened = factory.create({ kind: 'page' });
    try {
      const id = find(editor.session.snapshot().nodes, (node) => node.tag === 'p').id;
      editor.controller.beginRichText(id);
      expect(editor.controller.updateRichTextDraft('<p>Last bounded value</p>')).toBe(true);
      expect(
        editor.controller.updateRichTextDraft('x'.repeat(DocumentBudget.limits.sourceBytes + 1)),
      ).toBe(false);
      expect(editor.session.getState().pendingRichText).toMatchObject({
        html: '<p>Last bounded value</p>',
        valid: false,
        blocked: 'oversized',
        changed: true,
      });
      expect(await editor.session.save()).toBe(false);
      expect(() => editor.controller.exportSource()).toThrow('feedback.invalid');
      expect(editor.session.exportSource().html).toBe('<p>Original</p>');
      expect(
        await reopened.controller.importFile(
          new File([editor.controller.exportRecovery()], 'recovery.json'),
        ),
      ).toBe(true);
      expect(reopened.session.getState().pendingRichText).toMatchObject({
        valid: false,
        blocked: 'oversized',
      });
      expect(await reopened.session.save()).toBe(false);
      expect(reopened.controller.updateRichTextDraft('<p>Corrected value</p>')).toBe(true);
      expect(reopened.session.getState().pendingRichText?.blocked).toBeUndefined();
      expect(reopened.controller.commitRichText()).toBe(true);
      expect(reopened.session.exportSource().html).toBe('<p>Corrected value</p>');
      editor.controller.cancelRichText();
      expect(editor.session.getState().dirty).toBe(false);
    } finally {
      editor.dispose();
      reopened.dispose();
    }
  });

  it('preserves safe unknown attributes in JSON through trusted markers without projecting styles or classes', () => {
    const editor = factory.create({
      source: {
        html: '<p>Hello <span class="custom" style="color:red" data-native="keep">name</span> <a href="https://example.com" class="link">details</a> <small title="note">small</small></p><custom-card data-other="keep">Native</custom-card>',
        css: '',
      },
    });
    try {
      const data = editor.session.snapshot();
      const paragraph = find(data.nodes, (node) => node.tag === 'p');
      const span = find(data.nodes, (node) => node.tag === 'span');
      const anchor = find(data.nodes, (node) => node.tag === 'a');
      const small = find(data.nodes, (node) => node.tag === 'small');
      const projection = editor.controller.richTextFor(paragraph.id);
      expect(projection).not.toContain('class=');
      expect(projection).not.toContain('style=');
      expect(projection).not.toContain('data-native=');
      expect(projection).toContain(`data-editor-rich-origin="${span.id}"`);
      expect(editor.controller.beginRichText(paragraph.id)).toBe(true);
      expect(
        editor.controller.updateRichTextDraft(
          `<p>Hello <span data-editor-rich-origin="${span.id}">changed</span> <a href="https://example.com/next" data-editor-rich-origin="${anchor.id}">details</a> <span data-editor-rich-origin="${small.id}">small revised</span></p>`,
        ),
      ).toBe(true);
      expect(editor.controller.commitRichText()).toBe(true);
      const source = editor.session.exportSource().html;
      expect(source).toContain(
        '<span class="custom" style="color:red" data-native="keep">changed</span>',
      );
      expect(source).toContain('<a href="https://example.com/next" class="link">details</a>');
      expect(source).toContain('<small title="note">small revised</small>');
      expect(source).not.toContain('data-editor-rich-origin');
      expect(source).toContain('<custom-card data-other="keep">Native</custom-card>');
    } finally {
      editor.dispose();
    }
  });

  it('refuses markers from other regions and attribute injection', () => {
    const editor = factory.create({
      source: {
        html: '<p id="first"><span class="one">One</span></p><p id="second"><span class="two">Two</span></p>',
        css: '',
      },
    });
    try {
      const data = editor.session.snapshot();
      const first = find(data.nodes, (node) => node.attrs?.id === 'first');
      const other = find(data.nodes, (node) => node.attrs?.class === 'two');
      expect(editor.controller.beginRichText(first.id)).toBe(true);
      expect(
        editor.controller.updateRichTextDraft(
          `<p><span data-editor-rich-origin="${other.id}">Steal attributes</span></p>`,
        ),
      ).toBe(false);
      expect(editor.controller.updateRichTextDraft('<p class="host-danger">Class</p>')).toBe(false);
      expect(editor.controller.commitRichText()).toBe(false);
      expect(editor.session.snapshot()).toEqual(data);
      editor.controller.cancelRichText();
      expect(editor.session.snapshot()).toEqual(data);
    } finally {
      editor.dispose();
    }
  });

  it('preserves formatting across legitimate mark splits without cloning HTML identity', () => {
    const editor = factory.create({
      source: {
        html: '<p><span id="unique" class="brand" style="color:red">AB</span></p>',
        css: '',
      },
    });
    try {
      const data = editor.session.snapshot();
      const paragraph = find(data.nodes, (node) => node.tag === 'p');
      const span = find(data.nodes, (node) => node.tag === 'span');
      expect(editor.controller.beginRichText(paragraph.id)).toBe(true);
      expect(
        editor.controller.updateRichTextDraft(
          `<p><strong><span data-editor-rich-origin="${span.id}">A</span></strong><span data-editor-rich-origin="${span.id}">B</span></p>`,
        ),
      ).toBe(true);
      expect(editor.controller.commitRichText()).toBe(true);
      const html = editor.session.exportSource().html;
      expect(html).toContain(
        '<strong><span id="unique" class="brand" style="color:red">A</span></strong>',
      );
      expect(html).toContain('<span class="brand" style="color:red">B</span>');
      expect(html.match(/id="unique"/g)).toHaveLength(1);
      expect(html).not.toContain('data-editor-rich-origin');
    } finally {
      editor.dispose();
    }
  });

  it('uses the same catalog capabilities for the inspector and visual mutations', () => {
    const editor = factory.create({
      source: {
        html: '<section><h2>Title</h2><img src="https://example.com/image.png" alt="Sample"></section>',
        css: '',
      },
    });
    try {
      const heading = find(editor.session.snapshot().nodes, (node) => node.tag === 'h2');
      const image = find(editor.session.snapshot().nodes, (node) => node.tag === 'img');
      editor.controller.select(heading.id);
      expect(editor.controller.propertyCapabilities()?.styles).toEqual(
        expect.arrayContaining(['line-height', 'border-color', 'padding-left']),
      );
      expect(editor.controller.updateStyle('line-height', '1.5')).toBe(true);
      expect(editor.controller.updateStyle('position', 'fixed')).toBe(false);
      expect(editor.controller.updateAttribute('src', 'https://example.com/other.png')).toBe(false);
      editor.controller.select(image.id);
      expect(editor.controller.propertyCapabilities()?.attributes).toEqual(
        expect.arrayContaining(['src', 'alt']),
      );
      expect(editor.controller.updateAttribute('alt', 'Changed')).toBe(true);
      expect(editor.controller.updateAttribute('href', 'https://example.com')).toBe(false);
    } finally {
      editor.dispose();
    }
  });

  it('broadcasts one frozen state and isolates an observer that attempts to mutate it', () => {
    const editor = factory.create({ source: { html: '<p>Original</p>', css: '' } });
    try {
      const received: EditorState[] = [];
      let mutate = false;
      editor.session.subscribe((state) => {
        if (mutate) Object.assign(state.document.nodes[0]!, { tag: 'script' });
      });
      editor.session.subscribe((state) => received.push(state));
      editor.session.subscribe((state) => received.push(state));
      received.length = 0;
      mutate = true;
      const id = find(editor.session.snapshot().nodes, (node) => node.tag === 'p').id;
      expect(editor.session.updateText(id, 'Accepted')).toBe(true);
      expect(received).toHaveLength(2);
      expect(received[0]).toBe(received[1]);
      expect(Object.isFrozen(received[0]?.document.nodes)).toBe(true);
      expect(editor.session.exportSource().html).toBe('<p>Accepted</p>');
    } finally {
      editor.dispose();
    }
  });
});

it('uses the configured URL policy when projecting and reopening rich-text links', () => {
  const editor = factory.create({
    source: { html: '<p>Olá <a href="{{profileUrl}}">perfil</a></p>', css: '' },
    exactUrlPlaceholders: ['{{profileUrl}}'],
  });
  try {
    const id = find(editor.session.snapshot().nodes, (node) => node.tag === 'p').id;
    expect(editor.controller.richTextFor(id)).toContain('href="{{profileUrl}}"');
    expect(editor.controller.beginRichText(id)).toBe(true);
    expect(
      editor.controller.updateRichTextDraft('<p>Veja <a href="{{profileUrl}}">seu perfil</a></p>'),
    ).toBe(true);
    expect(editor.controller.commitRichText()).toBe(true);
    expect(editor.controller.richTextFor(id)).toContain('href="{{profileUrl}}"');
    expect(editor.controller.beginRichText(id)).toBe(true);
    expect(editor.controller.propertyCapabilities()?.richText).toBe(true);
    editor.controller.cancelRichText();
    expect(editor.session.exportSource().html).toContain('href="{{profileUrl}}"');
  } finally {
    editor.dispose();
  }
});
