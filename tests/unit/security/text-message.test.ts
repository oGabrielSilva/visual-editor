import { describe, expect, it } from 'vitest';
import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import {
  PREVIEW_MESSAGE_BUDGETS,
  PreviewMessagePolicy,
  TEXT_PROJECTION_BYTES,
} from '../../../src/security/preview-message';
import { SelectionPreviewRenderer } from '../../../src/renderers/selection-preview';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { ContentPolicy } from '../../../src/security/policy';
import { HtmlDocumentAssembler } from '../../../src/renderers/preview-document';
import { DocumentBudget } from '../../../src/core/budget';
import { emptyRichTextState } from '../../../src/rich-text/commands';

const policy = new ContentPolicy();
const codec = new HtmlDocumentCodec(policy);
const renderer = new SelectionPreviewRenderer(
  codec,
  policy,
  new HtmlDocumentAssembler(codec, policy),
);

function fixture(readOnly = false) {
  const result = codec.import(
    {
      html: '<main><p>Um <span class="brand">trecho</span></p><td>x</td><img alt="Imagem"/><a href="https://example.test/">Botão</a></main>',
      css: '',
    },
    'page',
  );
  if (!result.document) throw new Error('Invalid fixture');
  const preview = renderer.build(result.document, 'Selecionar', { readOnly });
  const text = preview.regions.find((region) => region.editable && region.links);
  const image = preview.regions.find((region) => !region.editable && !region.container);
  if (!text || !image) throw new Error('Missing regions');
  return { preview, text, image, document: result.document };
}

const rect = { x: 1, y: 2, width: 3, height: 4 };
const state = () => {
  const { marks, styles, link, href, empty, canUndo, canRedo } = emptyRichTextState();
  return { marks, styles, link, href, empty, canUndo, canRedo, rect };
};

describe('text edited in the frame crosses the bridge only as bounded, typed messages', () => {
  it('accepts each new message for an editable region and classifies none as free-form', () => {
    const { preview, text } = fixture();
    const messages = new PreviewMessagePolicy(() => 0);
    const frame = {};
    let sequence = 0;
    const send = (type: string, extra: Record<string, unknown> = {}) =>
      messages.canvas(
        { type, nonce: preview.nonce, revision: preview.revision, sequence: ++sequence, ...extra },
        frame,
        frame,
        preview,
      );
    expect(send('text-begin', { nodeId: text.id })?.type).toBe('text-begin');
    expect(send('text-draft', { nodeId: text.id, html: '<p>Um</p>' })?.type).toBe('text-draft');
    expect(send('text-state', { nodeId: text.id, ...state() })?.type).toBe('text-state');
    expect(
      send('text-state', { nodeId: text.id, ...state(), marks: ['bold', 'bulletList'] })?.type,
    ).toBe('text-state');
    expect(send('text-commit', { nodeId: text.id, html: '<p>Dois</p>' })?.type).toBe('text-commit');
    expect(send('text-cancel', { nodeId: text.id })?.type).toBe('text-cancel');
    expect(send('history', { direction: 'undo' })?.type).toBe('history');
    // Fidelity reports belong to the test mode of the preview only.
    expect(send('text-fidelity', { changed: 0 })).toBeUndefined();
    expect(send('text-unsupported', { nodeId: text.id })?.type).toBe('text-unsupported');
    expect(send('morph-failed')?.type).toBe('morph-failed');
  });

  it('refuses the removed intents, unknown fields, wrong targets and oversized text', () => {
    const { preview, text, image } = fixture();
    const messages = new PreviewMessagePolicy(() => 0);
    const frame = {};
    expect(
      messages.canvas(
        {
          type: 'text-begin',
          nonce: preview.nonce,
          revision: preview.revision,
          sequence: 1,
          nodeId: text.id,
        },
        frame,
        frame,
        preview,
      ),
    ).toBeDefined();
    const base = { nonce: preview.nonce, revision: preview.revision, sequence: 2 };
    const refused: Record<string, unknown>[] = [
      { ...base, type: 'edit', nodeId: text.id },
      { ...base, type: 'editing', active: true },
      { ...base, type: 'text-begin', nodeId: image.id },
      { ...base, type: 'text-begin', nodeId: 'missing' },
      { ...base, type: 'text-begin', nodeId: text.id, html: '<p>x</p>' },
      { ...base, type: 'text-draft', nodeId: text.id },
      { ...base, type: 'text-draft', nodeId: text.id, html: 7 },
      { ...base, type: 'text-draft', nodeId: image.id, html: '<p>x</p>' },
      {
        ...base,
        type: 'text-commit',
        nodeId: text.id,
        html: 'x'.repeat(DocumentBudget.limits.sourceBytes + 1),
      },
      {
        ...base,
        type: 'text-commit',
        nodeId: text.id,
        // Within the character limit, beyond the byte limit of the session.
        html: 'é'.repeat(DocumentBudget.limits.sourceBytes / 2 + 1),
      },
      { ...base, type: 'text-commit', nodeId: text.id, html: '<p>x</p>', url: 'https://x.test' },
      { ...base, type: 'text-state', nodeId: text.id, ...state(), marks: ['script'] },
      { ...base, type: 'text-state', nodeId: text.id, ...state(), href: 'x'.repeat(2049) },
      { ...base, type: 'text-state', nodeId: text.id, ...state(), rect: { ...rect, x: Infinity } },
      {
        ...base,
        type: 'text-state',
        nodeId: text.id,
        ...state(),
        styles: { ...state().styles, color: { value: 'x'.repeat(201), own: true, mixed: false } },
      },
      { ...base, type: 'text-state', nodeId: text.id, ...state(), html: '<b>x</b>' },
      { ...base, type: 'history', direction: 'sideways' },
      { ...base, type: 'text-fidelity', changed: -1 },
      { ...base, type: 'text-command', command: 'bold' },
      { ...base, type: 'document', html: '<p>x</p>', regions: [], readOnly: false },
      { ...base, type: 'text-rejected', nodeId: text.id, reason: 'commit' },
    ];
    for (const message of refused)
      expect(
        messages.canvas(message, frame, frame, preview),
        JSON.stringify(message).slice(0, 80),
      ).toBeUndefined();
    // None of the refusals consumed the sequence of the legitimate bridge.
    expect(
      messages.canvas({ ...base, type: 'text-begin', nodeId: text.id }, frame, frame, preview),
    ).toBeDefined();
    for (const wrong of [
      { nonce: 'forged' },
      { revision: preview.revision + 1 },
      { sequence: 2 },
      { sequence: 20_000 },
    ])
      expect(
        messages.canvas(
          {
            ...base,
            sequence: 2,
            type: 'text-commit',
            nodeId: text.id,
            html: '<p>x</p>',
            ...wrong,
          },
          frame,
          frame,
          preview,
        ),
      ).toBeUndefined();
    expect(
      messages.canvas(
        { ...base, sequence: 3, type: 'text-commit', nodeId: text.id, html: '<p>x</p>' },
        {},
        frame,
        preview,
      ),
    ).toBeUndefined();
  });

  it('refuses every text message and history while the document is read-only', () => {
    const { preview, text } = fixture(true);
    const messages = new PreviewMessagePolicy(() => 0);
    const frame = {};
    const base = { nonce: preview.nonce, revision: preview.revision, sequence: 1 };
    for (const message of [
      { ...base, type: 'text-begin', nodeId: text.id },
      { ...base, type: 'text-draft', nodeId: text.id, html: '<p>x</p>' },
      { ...base, type: 'text-commit', nodeId: text.id, html: '<p>x</p>' },
      { ...base, type: 'text-cancel', nodeId: text.id },
      { ...base, type: 'text-state', nodeId: text.id, ...state() },
      { ...base, type: 'history', direction: 'undo' },
    ])
      expect(messages.canvas(message, frame, frame, preview)).toBeUndefined();
  });

  it('carries text only inside the transaction opened for that same node', () => {
    const { preview, text, document } = fixture();
    const other = preview.regions.find((region) => region.editable && region.id !== text.id);
    if (!other) throw new Error('Missing second region');
    const messages = new PreviewMessagePolicy(() => 0);
    const frame = {};
    let sequence = 0;
    const send = (type: string, extra: Record<string, unknown> = {}, target = preview) =>
      messages.canvas(
        { type, nonce: target.nonce, revision: target.revision, sequence: ++sequence, ...extra },
        frame,
        frame,
        target,
      );
    const html = '<p>x</p>';
    expect(send('text-draft', { nodeId: text.id, html })).toBeUndefined();
    expect(send('text-commit', { nodeId: text.id, html })).toBeUndefined();
    expect(send('text-state', { nodeId: text.id, ...state() })).toBeUndefined();
    expect(send('text-toolbar', { nodeId: text.id })).toBeUndefined();
    expect(send('text-begin', { nodeId: text.id })).toBeDefined();
    expect(send('text-draft', { nodeId: other.id, html })).toBeUndefined();
    expect(send('text-commit', { nodeId: other.id, html })).toBeUndefined();
    expect(send('text-toolbar', { nodeId: text.id })?.type).toBe('text-toolbar');
    expect(send('text-draft', { nodeId: text.id, html })).toBeDefined();
    expect(send('text-commit', { nodeId: text.id, html })).toBeDefined();
    // The commit closed the transaction: nothing more is accepted for it.
    expect(send('text-draft', { nodeId: text.id, html })).toBeUndefined();
    expect(send('text-begin', { nodeId: text.id })).toBeDefined();
    expect(send('text-cancel', { nodeId: text.id })).toBeDefined();
    expect(send('text-commit', { nodeId: text.id, html })).toBeUndefined();
    // A new window starts with no transaction, whatever the previous one had open.
    expect(send('text-begin', { nodeId: text.id })).toBeDefined();
    const next = renderer.build(document, 'Selecionar');
    sequence = 0;
    expect(send('text-draft', { nodeId: text.id, html }, next)).toBeUndefined();
  });

  it('bounds one text far below a document and drafts to typing speed', () => {
    const { preview, text } = fixture();
    let now = 0;
    const messages = new PreviewMessagePolicy(() => now);
    const frame = {};
    let sequence = 0;
    const send = (type: string, extra: Record<string, unknown>) =>
      messages.canvas(
        { type, nonce: preview.nonce, revision: preview.revision, sequence: ++sequence, ...extra },
        frame,
        frame,
        preview,
      );
    expect(send('text-begin', { nodeId: text.id })).toBeDefined();
    expect(TEXT_PROJECTION_BYTES).toBe(262_144);
    expect(
      send('text-draft', { nodeId: text.id, html: 'x'.repeat(TEXT_PROJECTION_BYTES) }),
    ).toBeDefined();
    expect(
      send('text-draft', { nodeId: text.id, html: 'x'.repeat(TEXT_PROJECTION_BYTES + 1) }),
    ).toBeUndefined();
    expect(
      send('text-commit', { nodeId: text.id, html: 'é'.repeat(TEXT_PROJECTION_BYTES / 2 + 1) }),
    ).toBeUndefined();
    now = 2_000;
    for (let index = 0; index < PREVIEW_MESSAGE_BUDGETS.draft; index += 1)
      expect(send('text-draft', { nodeId: text.id, html: `<p>${index}</p>` })).toBeDefined();
    expect(send('text-draft', { nodeId: text.id, html: '<p>a mais</p>' })).toBeUndefined();
    // A flood of drafts spends neither the commit nor the other intents.
    expect(send('text-commit', { nodeId: text.id, html: '<p>fim</p>' })?.type).toBe('text-commit');
  });

  it('accepts a fidelity report only from a preview built in test mode', () => {
    const { document } = fixture();
    const preview = renderer.build(document, 'Selecionar', { diagnostics: true });
    const messages = new PreviewMessagePolicy(() => 0);
    const frame = {};
    expect(preview.diagnostics).toBe(true);
    expect(
      messages.canvas(
        {
          type: 'text-fidelity',
          nonce: preview.nonce,
          revision: preview.revision,
          sequence: 1,
          changed: 2,
        },
        frame,
        frame,
        preview,
      )?.type,
    ).toBe('text-fidelity');
  });

  it('accepts the look of the selected block only as bounded numbers and closed names', () => {
    const { preview, text } = fixture(true);
    const messages = new PreviewMessagePolicy(() => 0);
    const frame = {};
    let sequence = 0;
    const style = {
      size: 16,
      lineHeight: 24,
      weight: 400,
      color: [10, 20, 30, 1],
      family: 'sans-serif',
      font: 'Arial',
      align: 'left',
      direction: 'ltr',
    };
    const send = (value: Record<string, unknown>) =>
      messages.canvas(
        {
          type: 'appearance',
          nonce: preview.nonce,
          revision: preview.revision,
          sequence: ++sequence,
          nodeId: text.id,
          style: value,
        },
        frame,
        frame,
        preview,
      );
    // Reading how a block looks changes nothing, so a read-only document still reports it.
    expect(send(style)?.type).toBe('appearance');
    expect(send({ ...style, lineHeight: 'normal' })?.type).toBe('appearance');
    for (const hostile of [
      { ...style, size: 161 },
      { ...style, size: Infinity },
      { ...style, lineHeight: 501 },
      { ...style, weight: 950 },
      { ...style, color: [10, 20, 30, 2] },
      { ...style, font: 'Comic Sans MS' },
      { ...style, family: 'url(https://x.test/font)' },
      { ...style, align: 'start' },
      { ...style, css: 'background:url(https://x.test)' },
    ])
      expect(send(hostile)).toBeUndefined();
  });
});

describe('a revision for a running window', () => {
  const scripts = (html: string): number => {
    let count = 0;
    const walk = (node: DefaultTreeAdapterMap['node']): void => {
      if ('tagName' in node && node.tagName === 'script') count += 1;
      if ('childNodes' in node) for (const child of node.childNodes) walk(child);
    };
    walk(parse(html));
    return count;
  };

  it('keeps the nonce and carries no script, while a new window gets both', () => {
    const { preview, document } = fixture();
    expect(scripts(preview.html)).toBe(1);
    const next = renderer.update(
      { ...document, revision: document.revision + 1 },
      'Selecionar',
      preview,
    );
    expect(next.nonce).toBe(preview.nonce);
    expect(next.revision).toBe(document.revision + 1);
    expect(scripts(next.html)).toBe(0);
    expect(next.html).toContain('data-visual-editor-node');
    expect(next.regions).toEqual(preview.regions);
    expect(renderer.build(document, 'Selecionar').nonce).not.toBe(preview.nonce);
    expect(() => renderer.update(document, 'Selecionar', { nonce: "x' 'unsafe-inline" })).toThrow(
      'INVALID_PREVIEW_NONCE',
    );
  });

  it('marks an origin only on the elements whose attributes or tag need restoring', () => {
    const { preview, text } = fixture();
    expect(preview.html).toMatch(/<span class="brand" data-visual-editor-text-origin="[^"]+">/);
    expect(preview.html).not.toMatch(/<p[^>]*data-visual-editor-text-origin/);
    expect(text.blocks).toBe(false);
    expect(
      preview.regions.find((region) => region.editable && region.links === false),
    ).toBeDefined();
  });
});
