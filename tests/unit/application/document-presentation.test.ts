import { describe, expect, it } from 'vitest';
import { createEditor } from '../../../src/composition/browser';
import type { DocumentNode } from '../../../src/core/document';

function all(nodes: readonly DocumentNode[]): readonly DocumentNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}

describe('transactional document presentation', () => {
  it('resizes an image with a known ratio in one undoable revision and preserves siblings and attributes', () => {
    const editor = createEditor({
      source: {
        html: '<main><img id="logo" width="400" height="200" src="https://example.test/a.png" alt="Logo" title="Original"><p>Keep</p></main>',
        css: '.keep{color:red}',
      },
    });
    const before = editor.session.snapshot();
    const image = all(before.nodes).find((node) => node.tag === 'img')!;
    editor.controller.select(image.id);
    expect(editor.controller.imageSize()?.ratio).toBe(2);
    expect(editor.controller.updateImageSize({ width: 200, preserveRatio: true })).toBe(true);
    const after = editor.session.snapshot();
    const changed = all(after.nodes).find((node) => node.id === image.id)!;
    expect(after.revision).toBe(before.revision + 1);
    expect(changed.attrs).toMatchObject({
      id: 'logo',
      width: '200',
      height: '100',
      alt: 'Logo',
      title: 'Original',
    });
    expect(editor.session.exportSource().html).toContain('Keep');
    expect(after.css).toBe(before.css);
    expect(changed.attrs?.style).toContain('height:auto');
    expect(changed.attrs?.style).toContain('aspect-ratio:200/100');
    expect(editor.controller.imageSize()?.ratio).toBe(2);
    expect(editor.session.undo()).toBe(true);
    expect(
      all(editor.session.snapshot().nodes).find((node) => node.id === image.id)?.attrs,
    ).toEqual(image.attrs);
    editor.dispose();
  });

  it('does not invent a ratio when height is automatic and preserves the original on invalid sizing', () => {
    const editor = createEditor({
      source: {
        html: '<img width="400" height="200" style="height:auto" src="https://example.test/a.png">',
        css: '',
      },
    });
    const image = all(editor.session.snapshot().nodes).find((node) => node.tag === 'img')!;
    editor.controller.select(image.id);
    expect(editor.controller.imageSize()?.ratio).toBeUndefined();
    const before = editor.session.snapshot();
    expect(editor.controller.updateImageSize({ width: 100, preserveRatio: true })).toBe(false);
    expect(editor.controller.updateImageSize({ width: 0 })).toBe(false);
    expect(editor.session.snapshot()).toEqual(before);
    expect(editor.controller.updateImageSize({ width: 120 })).toBe(true);
    const attrs = all(editor.session.snapshot().nodes).find((node) => node.id === image.id)?.attrs;
    expect(attrs?.height).toBeUndefined();
    expect(attrs?.style).toContain('height:auto');
    editor.dispose();
  });

  it('treats relative width as unknown and honors important inline dimensions', () => {
    for (const [style, ratio] of [
      ['width:50%;height:150px', undefined],
      ['width:600px!important;width:300px;height:300px', 2],
    ] as const) {
      const editor = createEditor({
        source: {
          html: `<img width="600" height="300" style="${style}" src="https://example.test/a.png">`,
          css: '',
        },
      });
      const image = all(editor.session.snapshot().nodes).find((node) => node.tag === 'img')!;
      editor.controller.select(image.id);
      expect(editor.controller.imageSize()?.ratio).toBe(ratio);
      if (ratio === undefined)
        expect(editor.controller.updateImageSize({ width: 200, preserveRatio: true })).toBe(false);
      else {
        expect(editor.controller.updateImageSize({ width: 200, preserveRatio: true })).toBe(true);
        expect(
          all(editor.session.snapshot().nodes).find((node) => node.id === image.id)?.attrs?.height,
        ).toBe('100');
      }
      editor.dispose();
    }
  });
  it('updates only the explicit document root and preserves individual styling and unrelated declarations', () => {
    const editor = createEditor({
      source: {
        html: '<main style="padding:24px;color:red"><p style="color:blue">Keep blue</p></main>',
        css: '.custom{color:green!important}',
      },
    });
    const before = editor.session.snapshot();
    expect(editor.controller.documentStyles()?.values.color).toBe('red');
    expect(editor.controller.updateDocumentStyle('color', '#111111')).toBe(true);
    const result = editor.session.exportSource();
    expect(result.html).toContain('padding:24px');
    expect(result.html).toContain('color:blue');
    expect(result.css).toBe(before.css);
    expect(editor.controller.updateDocumentStyle('color', '')).toBe(true);
    expect(editor.controller.documentStyles()?.values.color).toBeUndefined();
    expect(editor.controller.updateDocumentStyle('font-family', 'Arial, sans-serif')).toBe(true);
    const valid = editor.session.snapshot();
    expect(editor.controller.updateDocumentStyle('color', 'url(https://example.test/x)')).toBe(
      false,
    );
    expect(editor.controller.updateDocumentStyle('font-size', '900px')).toBe(false);
    expect(editor.session.snapshot()).toEqual(valid);
    editor.dispose();
  });

  it('distinguishes preserved original inline settings from inherited settings', () => {
    const editor = createEditor({
      source: {
        html: '<main style="font-size:1rem;font-family:CustomFont;color:var(--custom)"><p>Keep</p></main>',
        css: ':root{--custom:teal}',
      },
    });
    expect(editor.controller.documentStyles()?.originalProperties).toEqual([
      'font-family',
      'font-size',
      'color',
    ]);
    expect(editor.controller.documentStyles()?.values).toEqual({});
    expect(editor.session.exportSource().html).toContain('font-size:1rem');
    editor.dispose();
  });
  it('refuses ambiguous roots and readonly presentation mutations', () => {
    const fragment = createEditor({ source: { html: '<p>First</p><p>Second</p>', css: '' } });
    expect(fragment.controller.documentStyles()).toBeUndefined();
    expect(fragment.controller.updateDocumentStyle('color', 'red')).toBe(false);
    fragment.dispose();
    const editor = createEditor({
      readOnly: true,
      source: { html: '<main><img src="https://example.test/a.png"></main>', css: '' },
    });
    const before = editor.session.snapshot();
    editor.controller.select(all(before.nodes).find((node) => node.tag === 'img')!.id);
    expect(editor.controller.updateImageSize({ width: 200 })).toBe(false);
    expect(editor.controller.updateDocumentStyle('color', 'red')).toBe(false);
    expect(editor.session.snapshot()).toEqual(before);
    editor.dispose();
  });
});

describe('public recovery and template preview APIs', () => {
  it('restores pending unsafe HTML as an inert buffer and keeps the safe preview', () => {
    const original = createEditor({ source: { html: '<main><p>Safe</p></main>', css: '' } });
    original.controller.setMode('html');
    original.controller.setDraft('html', '<p>Uncommitted</p><script>attack()</script>');
    const recovery: unknown = JSON.parse(original.controller.exportRecovery());
    const restored = createEditor();
    expect(restored.controller.importRecovery(recovery)).toBe(true);
    expect(restored.session.getState().draftSource.html).toContain('<script>');
    expect(restored.controller.previewHtml()).toContain('Safe');
    expect(restored.controller.previewHtml()).not.toContain('attack()');
    expect(restored.session.getState().dirty).toBe(true);
    original.dispose();
    restored.dispose();
  });

  it('makes recovered valid text visible immediately and starts the next edit from recovered content', () => {
    const original = createEditor({ source: { html: '<main><p>Before</p></main>', css: '' } });
    const node = all(original.session.snapshot().nodes).find((candidate) => candidate.tag === 'p')!;
    expect(original.controller.beginRichText(node.id)).toBe(true);
    expect(original.controller.updateRichTextDraft('<p>Recovered text</p>')).toBe(true);
    const recovery: unknown = JSON.parse(original.controller.exportRecovery());
    const restored = createEditor();
    expect(restored.controller.importRecovery(recovery)).toBe(true);
    expect(restored.controller.previewHtml()).toContain('Recovered text');
    expect(restored.session.getState().pendingRichText).toBeUndefined();
    expect(restored.controller.beginRichText(node.id)).toBe(true);
    expect(restored.controller.richTextFor(node.id)).toContain('Recovered text');
    original.dispose();
    restored.dispose();
  });
  it('previews a real template without changing pending text, selection, revision or history', async () => {
    const editor = createEditor({ source: { html: '<main><p>Current</p></main>', css: '' } });
    editor.controller.setMode('html');
    editor.controller.setDraft('html', '<p>Pending</p>');
    const before = editor.session.getState();
    const id = editor.controller.templateList()[0]!.id;
    const preview = await editor.controller.templatePreview(id);
    expect(preview).toContain('Content-Security-Policy');
    expect(preview).toContain('<main>');
    expect(editor.session.getState()).toEqual(before);
    await expect(editor.controller.templatePreview('email-welcome')).rejects.toThrow(
      'feedback.invalid',
    );
    editor.dispose();
  });
});
