import { describe, expect, it } from 'vitest';
import {
  PREVIEW_MESSAGE_BUDGETS,
  PreviewMessagePolicy,
} from '../../../src/security/preview-message';
import {
  SelectionPreviewRenderer,
  previewThemeSchema,
} from '../../../src/renderers/selection-preview';
import { ElementSourceMap } from '../../../src/renderers/element-source';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { ContentPolicy } from '../../../src/security/policy';
import { HtmlDocumentAssembler } from '../../../src/renderers/preview-document';
import * as v from 'valibot';

const policy = new ContentPolicy();
const codec = new HtmlDocumentCodec(policy);
const renderer = new SelectionPreviewRenderer(
  codec,
  policy,
  new HtmlDocumentAssembler(codec, policy),
);
const SOURCE =
  '<main>\n  <p class="a">Um <strong>dois</strong></p>\n  <img alt="Foto" src="https://example.test/a.png">\n  <p>Três</p>\n</main>';
function fixture(readOnly = false) {
  const result = codec.import({ html: SOURCE, css: '' }, 'page');
  if (!result.document) throw new Error('Invalid fixture');
  const preview = renderer.build(result.document, 'Select', {
    readOnly,
    describe: (region) => (region.node.tag === 'img' ? 'Imagem' : `  ${'x'.repeat(200)}`),
  });
  const image = preview.regions.find((region) => region.media === 'image');
  const text = preview.regions.find((region) => region.editable);
  if (!image || !text) throw new Error('Missing regions');
  return { preview, image, text, document: result.document };
}
const frame = {};
const accept = (
  preview: ReturnType<typeof fixture>['preview'],
  data: Record<string, unknown>,
  selection: { readonly id: string | undefined } = {
    id: typeof data.nodeId === 'string' ? data.nodeId : undefined,
  },
) =>
  new PreviewMessagePolicy(() => 0).canvas(
    { nonce: preview.nonce, revision: preview.revision, sequence: 1, ...data },
    frame,
    frame,
    preview,
    { selectedNodeId: selection.id },
  );

describe('intents added for the shell: strict, bounded and tied to real regions', () => {
  it('describes each region with a bounded friendly name and marks images', () => {
    const { image, text } = fixture();
    expect(image.label).toBe('Imagem');
    expect(text.label).toHaveLength(80);
    expect(text.media).toBeUndefined();
  });

  it('accepts the insertion request, the context menu, the shortcut and the image resize', () => {
    const { preview, image, text } = fixture();
    const bounds = { x: 1, y: 2, width: 30, height: 40 };
    expect(accept(preview, { type: 'insert-request', nodeId: text.id, bounds })?.type).toBe(
      'insert-request',
    );
    expect(accept(preview, { type: 'context-menu', nodeId: text.id, x: 5, y: 6 })?.type).toBe(
      'context-menu',
    );
    expect(accept(preview, { type: 'shortcut', command: 'save' })?.type).toBe('shortcut');
    expect(accept(preview, { type: 'insertion-end' })?.type).toBe('insertion-end');
    expect(
      accept(preview, { type: 'image-resize', nodeId: image.id, width: 320, height: 160 })?.type,
    ).toBe('image-resize');
    expect(accept(preview, { type: 'action', nodeId: image.id, action: 'image' })?.type).toBe(
      'action',
    );
    expect(accept(preview, { type: 'action', nodeId: text.id, action: 'html' })?.type).toBe(
      'action',
    );
  });

  it('refuses unknown nodes, extra fields, values out of range and commands off the list', () => {
    const { preview, image, text } = fixture();
    const bounds = { x: 1, y: 2, width: 30, height: 40 };
    for (const data of [
      { type: 'insert-request', nodeId: 'missing', bounds },
      { type: 'insert-request', nodeId: text.id, bounds, html: '<b>x</b>' },
      { type: 'insert-request', nodeId: text.id, bounds: { ...bounds, width: Infinity } },
      { type: 'context-menu', nodeId: text.id, x: -1, y: 6 },
      { type: 'context-menu', nodeId: text.id, x: 5, y: 1e9 },
      { type: 'context-menu', nodeId: text.id, x: 5, y: 6, selector: 'body' },
      { type: 'shortcut', command: 'remove' },
      { type: 'shortcut', command: 'save', url: 'https://example.test' },
      { type: 'insertion-end', targetId: text.id },
      { type: 'image-resize', nodeId: text.id, width: 320, height: 160 },
      { type: 'image-resize', nodeId: image.id, width: 0, height: 160 },
      { type: 'image-resize', nodeId: image.id, width: 320.5, height: 160 },
      { type: 'image-resize', nodeId: image.id, width: 100_000, height: 160 },
      { type: 'action', nodeId: text.id, action: 'image' },
      { type: 'action', nodeId: text.id, action: 'eval' },
    ])
      expect(accept(preview, data), JSON.stringify(data)).toBeUndefined();
  });

  it('accepts the keyboard origin of a menu or a picker and a file dropped on an image', () => {
    const { preview, image, text } = fixture();
    const bounds = { x: 1, y: 2, width: 30, height: 40 };
    expect(
      accept(preview, { type: 'context-menu', nodeId: text.id, x: 5, y: 6, keyboard: true })?.type,
    ).toBe('context-menu');
    expect(
      accept(preview, { type: 'insert-request', nodeId: text.id, bounds, keyboard: true })?.type,
    ).toBe('insert-request');
    // A dropped file replaces any image of the piece, selected or not; never another block.
    expect(accept(preview, { type: 'image-drop', nodeId: image.id }, { id: undefined })?.type).toBe(
      'image-drop',
    );
    for (const data of [
      { type: 'context-menu', nodeId: text.id, x: 5, y: 6, keyboard: false },
      { type: 'context-menu', nodeId: text.id, x: 5, y: 6, keyboard: 'yes' },
      { type: 'insert-request', nodeId: text.id, bounds, keyboard: 1 },
      { type: 'image-drop', nodeId: text.id },
      { type: 'image-drop', nodeId: 'missing' },
      { type: 'image-drop', nodeId: image.id, url: 'https://example.test/x.png' },
    ])
      expect(accept(preview, data), JSON.stringify(data)).toBeUndefined();
    const readOnly = fixture(true);
    expect(
      accept(readOnly.preview, { type: 'image-drop', nodeId: readOnly.image.id }),
    ).toBeUndefined();
  });

  it('opens a menu or the picker only for the selected block and resizes the image just left', () => {
    const { preview, image, text } = fixture();
    const bounds = { x: 1, y: 2, width: 30, height: 40 };
    for (const data of [
      { type: 'context-menu', nodeId: text.id, x: 5, y: 6 },
      { type: 'insert-request', nodeId: text.id, bounds },
    ]) {
      expect(accept(preview, data, { id: image.id }), data.type).toBeUndefined();
      expect(accept(preview, data, { id: undefined }), data.type).toBeUndefined();
      expect(accept(preview, data, { id: text.id })?.type, data.type).toBe(data.type);
    }
    // A file over the frame carries nothing and is accepted even in a read-only document.
    expect(accept(preview, { type: 'file-drag' })?.type).toBe('file-drag');
    expect(accept(fixture(true).preview, { type: 'file-drag' })?.type).toBe('file-drag');
    expect(accept(preview, { type: 'file-drag', name: 'x.png' })).toBeUndefined();
    const resize = { type: 'image-resize', nodeId: image.id, width: 320, height: 160 };
    const policy = new PreviewMessagePolicy(() => 0);
    const message = { nonce: preview.nonce, revision: preview.revision, sequence: 1, ...resize };
    expect(
      policy.canvas(message, frame, frame, preview, {
        selectedNodeId: text.id,
        recentNodeId: image.id,
      })?.type,
    ).toBe('image-resize');
    expect(
      new PreviewMessagePolicy(() => 0).canvas(message, frame, frame, preview, {
        selectedNodeId: text.id,
        recentNodeId: text.id,
      }),
    ).toBeUndefined();
  });

  it('changes a block from the piece only while the host has that block selected', () => {
    const { preview, image, text } = fixture();
    const resize = { type: 'image-resize', nodeId: image.id, width: 320, height: 160 };
    expect(accept(preview, resize, { id: text.id })).toBeUndefined();
    expect(accept(preview, resize, { id: undefined })).toBeUndefined();
    expect(accept(preview, resize, { id: image.id })?.type).toBe('image-resize');
    for (const action of ['duplicate', 'up', 'down', 'remove', 'html', 'image'] as const) {
      const data = { type: 'action', nodeId: image.id, action };
      expect(accept(preview, data, { id: text.id }), action).toBeUndefined();
      expect(accept(preview, data, { id: undefined }), action).toBeUndefined();
      expect(accept(preview, data, { id: image.id })?.type, action).toBe('action');
    }
    // Without what the host knows nothing which changes a block is accepted.
    const messages = new PreviewMessagePolicy(() => 0);
    expect(
      messages.canvas(
        { nonce: preview.nonce, revision: preview.revision, sequence: 1, ...resize },
        frame,
        frame,
        preview,
      ),
    ).toBeUndefined();
    // Opening a text selects its block: it needs no selection beforehand.
    expect(accept(preview, { type: 'text-begin', nodeId: text.id }, { id: image.id })?.type).toBe(
      'text-begin',
    );
  });

  it('accepts one request to save per second, whatever else the frame sends', () => {
    let now = 0;
    const messages = new PreviewMessagePolicy(() => now);
    let sequence = 0;
    const send = (data: Record<string, unknown>) =>
      messages.canvas(
        { nonce: preview.nonce, revision: preview.revision, sequence: ++sequence, ...data },
        frame,
        frame,
        preview,
        { selectedNodeId: text.id },
      );
    const { preview, text } = fixture();
    expect(PREVIEW_MESSAGE_BUDGETS.shortcut).toBe(1);
    expect(send({ type: 'shortcut', command: 'save' })?.type).toBe('shortcut');
    for (let index = 0; index < 50; index++)
      expect(send({ type: 'shortcut', command: 'save' })).toBeUndefined();
    // The flood of one class never spends the allowance of another.
    expect(send({ type: 'context-menu', nodeId: text.id, x: 1, y: 1 })?.type).toBe('context-menu');
    now = 999;
    expect(send({ type: 'shortcut', command: 'save' })).toBeUndefined();
    now = 1_000;
    expect(send({ type: 'shortcut', command: 'save' })?.type).toBe('shortcut');
  });

  it('answers the question asked after a load only in the strict form of the protocol', () => {
    const { preview } = fixture();
    const challenge = 'a'.repeat(32);
    expect(accept(preview, { type: 'ready', challenge })).toMatchObject({ challenge });
    expect(accept(preview, { type: 'ready' })?.type).toBe('ready');
    for (const invalid of ['short', 'a'.repeat(65), 'with space and more text', 7])
      expect(accept(preview, { type: 'ready', challenge: invalid })).toBeUndefined();
  });

  it('refuses every one of them in a read-only document', () => {
    const { preview, image, text } = fixture(true);
    const bounds = { x: 1, y: 2, width: 30, height: 40 };
    for (const data of [
      { type: 'insert-request', nodeId: text.id, bounds },
      { type: 'context-menu', nodeId: text.id, x: 5, y: 6 },
      { type: 'shortcut', command: 'save' },
      { type: 'insertion-end' },
      { type: 'image-resize', nodeId: image.id, width: 320, height: 160 },
      { type: 'action', nodeId: image.id, action: 'image' },
    ])
      expect(accept(preview, data), JSON.stringify(data)).toBeUndefined();
  });

  it('only lets plain color values and a bounded radius into the theme of the controls', () => {
    const valid = { accent: 'oklch(0.6 0.118 184.704)', contrast: '#fff', radius: 0 };
    expect(v.safeParse(previewThemeSchema, valid).success).toBe(true);
    for (const theme of [
      { accent: 'red;background:url(https://example.test)' },
      { accent: 'url("x")' },
      { accent: 'var(--x)}body{display:none' },
      { radius: 99 },
      { accent: '#fff', unknown: 1 },
    ])
      expect(v.safeParse(previewThemeSchema, theme).success, JSON.stringify(theme)).toBe(false);
    const { document } = fixture();
    expect(() =>
      renderer.build(document, 'Select', { theme: { accent: '</style><script>' } }),
    ).toThrow();
  });
});

describe('ElementSourceMap: the exact stretch of the source one element occupies', () => {
  const sources = new ElementSourceMap();
  const { document, image, text } = fixture();
  const source = codec.export(document);

  it('reads an element as it is written and replaces nothing else', () => {
    expect(sources.read(document, source, text.id)).toBe(
      '<p class="a">Um <strong>dois</strong></p>',
    );
    expect(sources.read(document, source, image.id)).toBe(
      '<img alt="Foto" src="https://example.test/a.png">',
    );
    const replaced = sources.replace(document, source, image.id, '<hr>');
    expect(replaced?.html).toBe(
      source.html.replace('<img alt="Foto" src="https://example.test/a.png">', '<hr>'),
    );
    expect(replaced?.css).toBe(source.css);
  });

  it('answers nothing for an unknown node or a source which no longer matches the document', () => {
    expect(sources.read(document, source, 'missing')).toBeUndefined();
    expect(sources.read(document, { html: '<div>Outro</div>', css: '' }, text.id)).toBeUndefined();
    expect(sources.replace(document, { html: '', css: '' }, text.id, '<p>x</p>')).toBeUndefined();
  });

  it('is offered by the preview renderer over the canonical export', () => {
    expect(renderer.elementSource(document, text.id)).toBe(
      '<p class="a">Um <strong>dois</strong></p>',
    );
    expect(renderer.replaceElementSource(document, text.id, '<h2>Novo</h2>')?.html).toContain(
      '<h2>Novo</h2>',
    );
  });
});
