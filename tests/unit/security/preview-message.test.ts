import { describe, expect, it } from 'vitest';
import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import {
  PREVIEW_MESSAGE_BUDGETS,
  PreviewMessagePolicy,
} from '../../../src/security/preview-message';
import {
  normalizePreviewLanguage,
  SelectionPreviewRenderer,
} from '../../../src/renderers/selection-preview';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { ContentPolicy } from '../../../src/security/policy';
import { HtmlDocumentAssembler } from '../../../src/renderers/preview-document';

describe('owned iframe selection bridge', () => {
  const policy = new ContentPolicy();
  const codec = new HtmlDocumentCodec(policy);
  const renderer = new SelectionPreviewRenderer(
    codec,
    policy,
    new HtmlDocumentAssembler(codec, policy),
  );
  it('generates IDs and nonce after validation, strips attacker annotations and leaves original document untouched', () => {
    const imported = codec.import(
      { html: '<p data-visual-editor-node="attacker">A safe block</p>', css: '' },
      'page',
    );
    if (!imported.document) throw new Error('Invalid fixture');
    const original = structuredClone(imported.document);
    const preview = renderer.build(imported.document, 'Selecionar bloco');
    expect(preview.html).not.toContain('data-visual-editor-node="attacker"');
    expect(preview.html).toMatch(/script-src 'sha256-[A-Za-z0-9+/]{43}='/);
    expect(preview.html).not.toContain(`nonce="${preview.nonce}"`);
    expect(preview.html).not.toContain("'nonce-");
    expect(imported.document).toEqual(original);
    expect(renderer.build(imported.document, 'Selecionar bloco').nonce).not.toBe(preview.nonce);
  });

  it('adds inert preview metadata without changing the canonical snapshot or export', () => {
    const imported = codec.import({ html: '<p>Conteúdo preservado</p>', css: '' }, 'page');
    if (!imported.document) throw new Error('Invalid fixture');
    const original = structuredClone(imported.document);
    const output = codec.export(imported.document);
    const title = '</title><script>globalThis.compromised=true</script> & "seleção"';
    const preview = renderer.build(imported.document, 'Selecionar', { title, lang: 'en-US' });
    const tree = parse(preview.html);
    const elements: DefaultTreeAdapterMap['element'][] = [];
    const visit = (parent: DefaultTreeAdapterMap['parentNode']): void => {
      for (const child of parent.childNodes) {
        if (!('tagName' in child)) continue;
        elements.push(child);
        visit(child);
      }
    };
    visit(tree);
    const html = elements.find((element) => element.tagName === 'html');
    expect(html?.attrs.find((attribute) => attribute.name === 'lang')?.value).toBe('en-US');
    const heading = elements.find((element) => element.tagName === 'title');
    expect(heading?.childNodes).toHaveLength(1);
    expect(heading?.childNodes[0]).toMatchObject({ nodeName: '#text', value: title });
    expect(elements.filter((element) => element.tagName === 'script')).toHaveLength(1);
    expect(imported.document).toEqual(original);
    expect(codec.export(imported.document)).toEqual(output);
  });

  it('preserves explicit content language and title while bounding host metadata', () => {
    const imported = codec.import(
      {
        html: '<html lang="es"><head><title>Título original</title></head><body><p>Texto</p></body></html>',
        css: '',
      },
      'page',
    );
    const document = imported.document;
    if (!document) throw new Error('Invalid fixture');
    const output = codec.export(document);
    const preview = renderer.build(document, 'Select', {
      title: 'Preview title',
      lang: 'en',
    });
    const tree = parse(preview.html);
    const root = tree.childNodes.find((node) => 'tagName' in node && node.tagName === 'html');
    if (!root || !('attrs' in root)) throw new Error('Missing preview root');
    expect(root.attrs.find((attribute) => attribute.name === 'lang')?.value).toBe('es');
    expect(preview.html).toContain('<title>Título original</title>');
    expect(codec.export(document)).toEqual(output);
    for (const lang of ['not a language', 'en" onload="bad()', 'x'.repeat(101)])
      expect(() => renderer.build(document, 'Select', { lang })).toThrow();
    for (const title of ['', ' ', 'x'.repeat(201)])
      expect(() => renderer.build(document, 'Select', { title })).toThrow();
  });

  it('normalizes bounded DOM language without weakening the strict public renderer options', () => {
    expect(normalizePreviewLanguage(' en-us ')).toBe('en-US');
    expect(normalizePreviewLanguage('es')).toBe('es');
    for (const value of [undefined, '', 'pt_BR', 'not a language', 'x'.repeat(101)])
      expect(normalizePreviewLanguage(value)).toBeUndefined();
  });

  it('uses an explicit unknown language and requires a nonempty derived title', () => {
    const imported = codec.import({ html: '<p>Texto</p>', css: '' }, 'page');
    const document = imported.document;
    if (!document) throw new Error('Invalid fixture');
    expect(renderer.build(document, 'Selecionar').html).toContain('<html lang="und">');
    expect(() => renderer.build(document, ' ')).toThrow('PREVIEW_TITLE_REQUIRED');
  });

  it('accepts only the current frame, nonce, revision, known node and exact message schema', () => {
    const imported = codec.import({ html: '<p>Safe</p>', css: '' }, 'page');
    if (!imported.document) throw new Error('Invalid fixture');
    const preview = renderer.build(imported.document, 'Selecionar bloco');
    const messages = new PreviewMessagePolicy();
    const frame = {};
    const message = {
      type: 'selection',
      nonce: preview.nonce,
      revision: preview.revision,
      nodeId: preview.nodeIds[0],
    };
    expect(messages.selection(message, frame, frame, preview)).toBe(preview.nodeIds[0]);
    expect(messages.selection(message, {}, frame, preview)).toBeUndefined();
    expect(
      messages.selection({ ...message, nonce: 'forged' }, frame, frame, preview),
    ).toBeUndefined();
    expect(
      messages.selection({ ...message, revision: preview.revision + 1 }, frame, frame, preview),
    ).toBeUndefined();
    expect(
      messages.selection({ ...message, nodeId: 'missing' }, frame, frame, preview),
    ).toBeUndefined();
    expect(
      messages.selection({ ...message, html: '<script>attack()</script>' }, frame, frame, preview),
    ).toBeUndefined();
    expect(
      messages.selection(
        message,
        frame,
        frame,
        renderer.build(imported.document, 'Selecionar bloco'),
      ),
    ).toBeUndefined();
  });

  it('keeps handshakes and intents alive while a 120 Hz display floods measurements', () => {
    const imported = codec.import({ html: '<main><p>Um</p><p>Dois</p></main>', css: '' }, 'page');
    if (!imported.document) throw new Error('Invalid fixture');
    const preview = renderer.build(imported.document, 'Selecionar bloco');
    const [first, second] = preview.regions.filter((region) => region.editable);
    if (!first || !second) throw new Error('Missing regions');
    let now = 0;
    const messages = new PreviewMessagePolicy(() => now);
    const frame = {};
    let sequence = 0;
    const send = (type: string, extra: Record<string, unknown> = {}) =>
      messages.canvas(
        { type, nonce: preview.nonce, revision: preview.revision, sequence: ++sequence, ...extra },
        frame,
        frame,
        preview,
        { selectedNodeId: typeof extra.nodeId === 'string' ? extra.nodeId : undefined },
      );
    const viewport = { x: 0, y: 0 };
    const bounds = { x: 0, y: 0, width: 200, height: 20 };
    expect(send('ready')?.type).toBe('ready');
    // Three seconds of scrolling: every frame reports the viewport and the selected geometry.
    for (let frameIndex = 0; frameIndex < 360; frameIndex += 1) {
      now = (frameIndex * 1_000) / 120;
      expect(send('viewport', { viewport })?.type).toBe('viewport');
      expect(send('geometry', { nodeId: first.id, bounds, viewport })?.type).toBe('geometry');
      if (frameIndex % 120 !== 119) continue;
      // At the end of each saturated second, control and intent messages still get through.
      expect(send('viewport-restored', { viewport })?.type).toBe('viewport-restored');
      expect(send('ready')?.type).toBe('ready');
      expect(
        messages.selection(
          {
            type: 'selection',
            nonce: preview.nonce,
            revision: preview.revision,
            nodeId: second.id,
          },
          frame,
          frame,
          preview,
        ),
      ).toBe(second.id);
      expect(send('text-begin', { nodeId: second.id })?.type).toBe('text-begin');
      expect(send('action', { nodeId: second.id, action: 'up' })?.type).toBe('action');
      expect(
        send('move', { sourceId: second.id, targetId: first.id, placement: 'before' })?.type,
      ).toBe('move');
      expect(send('insertion', { targetId: first.id, placement: 'after' })?.type).toBe('insertion');
    }
  });

  it('drops only measurements when they exceed their own allowance', () => {
    const imported = codec.import({ html: '<p>Um</p>', css: '' }, 'page');
    if (!imported.document) throw new Error('Invalid fixture');
    const preview = renderer.build(imported.document, 'Selecionar bloco');
    const messages = new PreviewMessagePolicy(() => 0);
    const frame = {};
    let sequence = 0;
    const send = (type: string) =>
      messages.canvas(
        {
          type,
          nonce: preview.nonce,
          revision: preview.revision,
          sequence: ++sequence,
          ...(type === 'ready' ? {} : { viewport: { x: 0, y: 0 } }),
        },
        frame,
        frame,
        preview,
      );
    for (let index = 0; index < PREVIEW_MESSAGE_BUDGETS.telemetry; index += 1)
      expect(send('viewport')).toBeDefined();
    expect(send('viewport')).toBeUndefined();
    expect(send('viewport-restored')?.type).toBe('viewport-restored');
    expect(send('ready')?.type).toBe('ready');
    // Handshakes are bounded too, so a hostile frame cannot flood the host with them.
    for (let index = 2; index < PREVIEW_MESSAGE_BUDGETS.control; index += 1)
      expect(send('ready')).toBeDefined();
    expect(send('ready')).toBeUndefined();
    expect(send('viewport-restored')).toBeUndefined();
  });

  it('never authorizes a script of the document', () => {
    // The document script is part of the page. The frame policy only trusts
    // the digest of the text of the bridge, so no script of the document ever runs.
    const scripted = codec.import(
      {
        html: '<p onclick="steal()">Safe</p><script nonce="guess">steal()</script><a href="javascript:steal()">x</a>',
        css: '',
      },
      'page',
    );
    if (!scripted.document) throw new Error('Refused');
    const preview = renderer.build(scripted.document, 'Selecionar');
    const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(
      preview.html,
    )?.[1];
    expect(policy).toContain("default-src 'none'");
    expect(policy).toMatch(/script-src 'sha256-[A-Za-z0-9+/]{43}='$/);
    expect(policy).not.toContain('nonce-');
    expect(policy).not.toContain("script-src 'unsafe-inline'");
    expect(policy?.split(';').filter((part) => part.trim().startsWith('script-src'))).toHaveLength(
      1,
    );
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("'strict-dynamic'");
    const scripts = [...preview.html.matchAll(/<script(?=[\s>])([^>]*)>/g)].map(
      (match) => match[1],
    );
    expect(scripts).toHaveLength(2);
    // The script of the editor carries no attribute at all: its text is what the policy trusts.
    expect(scripts.filter((attrs) => attrs === '')).toHaveLength(1);
    expect(scripts.filter((attrs) => attrs?.includes(preview.nonce))).toHaveLength(0);
    expect(preview.html).toContain('<script nonce="guess">steal()</script>');
    expect(preview.html.indexOf('Content-Security-Policy')).toBeLessThan(
      preview.html.indexOf('<script'),
    );
  });
});
