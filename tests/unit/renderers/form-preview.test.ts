import { describe, expect, it, vi } from 'vitest';
import { createServerEditor } from '../../../src/composition/server';
import { FORM_PREVIEW_LIMITS, FormPreviewCache } from '../../../src/vue/services/form-preview';

const SLOT =
  '<section><h2>Comece</h2><div data-host-slot="form" data-host-reference="form_1"></div></section>';
const PICTURE =
  '<form action="https://evil.example/x"><label>Nome<input name="nome" onfocus="alert(1)" autofocus></label>' +
  '<script>alert(1)</script><iframe src="https://evil.example"></iframe>' +
  '<a href="javascript:alert(1)" data-visual-editor-node="x">link</a>' +
  '<img src="https://cdn.example/logo.png"><img src="javascript:alert(1)">' +
  '<button type="submit" style="background:url(https://evil.example/t)">Enviar</button></form>';

function body(html: string): string {
  return html.slice(html.indexOf('<body'), html.indexOf('</body>'));
}

describe('form preview in the canvas', () => {
  it('draws the picture inside the connected slot, inert and without active content', () => {
    const editor = createServerEditor({ kind: 'page', source: { html: SLOT, css: '' } });
    const document = editor.session.snapshot();
    const shown = editor.selectionRenderer.build(document, 'Selecionar', {
      formPreview: (reference) => (reference === 'form_1' ? PICTURE : undefined),
    });
    const canvas = body(shown.html);
    expect(canvas).toContain('data-editor-form-preview=""');
    expect(canvas).toMatch(/data-editor-form-preview="" inert="" aria-hidden="true"/);
    expect(canvas).toContain('Nome');
    expect(canvas).toContain('src="https://cdn.example/logo.png"');
    for (const blocked of [
      'onfocus',
      'autofocus',
      'evil.example',
      'javascript:',
      '<iframe',
      'alert(1)</script>',
      'data-visual-editor-node="x"',
    ])
      expect(canvas).not.toContain(blocked);
    // The node marks are the document's only: the picture adds none.
    expect(shown.nodeIds.length).toBe(
      editor.selectionRenderer.build(document, 'Selecionar').nodeIds.length,
    );
  });

  it('never reaches the document, the export or a slot without a reference', () => {
    const editor = createServerEditor({
      kind: 'page',
      source: { html: '<div data-host-slot="form"></div>', css: '' },
    });
    const lookup = vi.fn(() => PICTURE);
    const shown = editor.selectionRenderer.build(editor.session.snapshot(), 'Selecionar', {
      formPreview: lookup,
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(shown.html).not.toContain('data-editor-form-preview');
    expect(editor.session.exportSource().html).not.toContain('Nome');
  });

  it('asks the host once per form and draws again when the picture arrives', async () => {
    const preview = vi.fn(async (reference: string) => `<p>${reference}</p>`);
    const cache = new FormPreviewCache(() => ({ preview }));
    expect(cache.lookup('form_1')).toBeUndefined();
    expect(cache.lookup('form_1')).toBeUndefined();
    await vi.waitFor(() => expect(cache.version.value).toBe(1));
    expect(cache.lookup('form_1')).toBe('<p>form_1</p>');
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it('ignores failures, empty and oversized pictures, and answers after disposal', async () => {
    const big = 'x'.repeat(FORM_PREVIEW_LIMITS.bytes + 1);
    const answers: Record<string, () => Promise<string | undefined>> = {
      failed: () => Promise.reject(new Error('offline')),
      empty: async () => '  ',
      big: async () => `<p>${big}</p>`,
    };
    const cache = new FormPreviewCache(() => ({ preview: (reference) => answers[reference]!() }));
    for (const reference of Object.keys(answers)) cache.lookup(reference);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cache.version.value).toBe(0);
    for (const reference of Object.keys(answers)) expect(cache.lookup(reference)).toBeUndefined();

    let release: (html: string) => void = () => undefined;
    const late = new FormPreviewCache(() => ({
      preview: () => new Promise<string>((resolve) => (release = resolve)),
    }));
    late.lookup('form_1');
    late.dispose();
    await Promise.resolve();
    release('<p>tarde</p>');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(late.version.value).toBe(0);
    expect(late.lookup('form_1')).toBeUndefined();
  });
});
