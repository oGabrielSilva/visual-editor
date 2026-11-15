import { describe, expect, it } from 'vitest';
import { EditorDocument } from '../../src/core/document';
import type { EditorDocumentData } from '../../src/core/document';
import { ContentPolicy } from '../../src/security/policy';
import { HtmlDocumentCodec } from '../../src/codecs/html';
import { CssDocumentCodec } from '../../src/codecs/css';
import mjml from 'mjml';
import { CompilationGuard, MJML_OPTIONS } from '../../src/compilation/guard';
import { SelectionPreviewRenderer } from '../../src/renderers/selection-preview';
import { HtmlDocumentAssembler } from '../../src/renderers/preview-document';

function document(nodes: EditorDocumentData['nodes']): EditorDocumentData {
  return { schemaVersion: 1, id: 'external', kind: 'page', revision: 0, title: '', css: '', nodes };
}

describe('independent architecture fitness: external JSON boundary', () => {
  it('exposes a hosted URL hidden in a custom property without treating normal typography as an executable URL', () => {
    const css =
      ':root{--image:"https://media.example.test/\\66 oreign.png";--font:"Arial, sans-serif"}div{background-image:image-set(var(--image) 1x);font-family:var(--font)}';
    const inspected = new CssDocumentCodec().inspect(css);
    expect(inspected.diagnostics).toEqual([]);
    expect(inspected.urlCandidates).toContain('https://media.example.test/foreign.png');
    expect(inspected.urls).not.toContain('Arial, sans-serif');
    expect(
      new HtmlDocumentCodec().import({ html: '<div>Content</div>', css }, 'page').document,
    ).toBeDefined();
  });

  it('accepts an explicit loopback image origin for local preview and refuses unsafe CSP origin configuration', () => {
    const policy = new ContentPolicy();
    const codec = new HtmlDocumentCodec(policy);
    const source = { html: '<img src="/_assets-local/sample.png" alt="Local sample">', css: '' };
    const safe = new HtmlDocumentAssembler(codec, policy, ['http://localhost:5173']);
    expect(safe.build(source, 'page', true)).toContain('http://localhost:5173');
    for (const origin of [
      'http://untrusted.example',
      'https://example.test/path',
      'https://user:secret@example.test',
      'https://example.test/#fragment',
      'https://example.test/?search',
    ]) {
      expect(() => new HtmlDocumentAssembler(codec, policy, [origin])).toThrow(
        'INVALID_PREVIEW_ORIGIN',
      );
    }
  });

  it('rejects children of void nodes before serialization can discard them', () => {
    const input = document([
      {
        id: 'image',
        type: 'element',
        tag: 'img',
        attrs: { src: 'https://example.com/image.png' },
        children: [{ id: 'lost', type: 'text', value: 'Must not disappear' }],
      },
    ]);
    expect(() => new ContentPolicy().assertSafe(input)).toThrow();
    expect(() => new HtmlDocumentCodec().export(input)).toThrow();
  });

  it('rejects external JSON whose table cell would disappear during HTML serialization and reimport', () => {
    const input = document([
      {
        id: 'orphan-cell',
        type: 'element',
        tag: 'td',
        attrs: { 'data-native': 'preserved' },
        children: [{ id: 'native-label', type: 'text', value: 'Native cell' }],
      },
    ]);
    expect(() => new HtmlDocumentCodec().export(input)).toThrow();
  });

  it('keeps a safe style-bearing HTML fragment importable and portable', () => {
    const source = {
      html: '<style>.x{color:red}</style><div class="x">Safe content</div>',
      css: '',
    };
    const first = new HtmlDocumentCodec().import(source, 'page');
    expect(first.diagnostics).toEqual([]);
    expect(first.document).toBeDefined();
    if (!first.document) throw new Error('Fixture must remain importable');
    const reopened = new HtmlDocumentCodec().export(first.document);
    expect(reopened.html).toContain('Safe content');
    expect(reopened.html).toContain('.x{color:red}');
  });

  it('accounts for property keys in external JSON resource limits', () => {
    const input = document([
      {
        id: 'oversized-attribute-name',
        type: 'element',
        tag: 'p',
        attrs: { ['a'.repeat(2_000_001)]: 'value' },
        children: [],
      },
    ]);
    expect(() => EditorDocument.from(input)).toThrow();
  });

  it('does not accept an ambiguous case-insensitive duplicate HTML attribute', () => {
    const input = document([
      {
        id: 'ambiguous-link',
        type: 'element',
        tag: 'a',
        attrs: { href: 'https://example.com/first', HREF: 'https://example.com/second' },
        children: [{ id: 'label', type: 'text', value: 'Link' }],
      },
    ]);
    expect(() => new ContentPolicy().assertSafe(input)).toThrow();
  });

  it('can instrument a valid node at the public attribute limit without invalidating the document', () => {
    const attrs = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [`data-field-${index}`, 'safe']),
    );
    const input = document([
      {
        id: 'maximum-valid-attrs',
        type: 'element',
        tag: 'p',
        attrs,
        children: [{ id: 'label', type: 'text', value: 'Content' }],
      },
    ]);
    const before = structuredClone(input);
    const policy = new ContentPolicy();
    const codec = new HtmlDocumentCodec(policy);
    policy.assertSafe(input);
    const renderer = new SelectionPreviewRenderer(
      codec,
      policy,
      new HtmlDocumentAssembler(codec, policy),
    );
    const preview = renderer.build(input, 'Select content');
    expect(preview.nodeIds).toContain('maximum-valid-attrs');
    expect(input).toEqual(before);
  });

  it('accepts the actual supported MJML output and keeps a redirect out of the editor frame', async () => {
    const compiled = await mjml(
      '<mjml><mj-body><mj-section><mj-column><mj-text>Safe email</mj-text></mj-column></mj-section></mj-body></mjml>',
      MJML_OPTIONS,
    );
    expect(
      new HtmlDocumentCodec().import({ html: compiled.html, css: '' }, 'email').diagnostics,
    ).toEqual([]);
    expect(() => new CompilationGuard().output(compiled.html)).not.toThrow();
    const html = '<meta http-equiv="refresh" content="0;url=https://example.com/"><p>Safe</p>';
    // An e-mail loses every refresh: it sends the message elsewhere. A page keeps it; the copy inside the editor never does.
    const removed = new HtmlDocumentCodec().import({ html, css: '' }, 'email');
    expect(removed.diagnostics.map((item) => item.code)).toEqual(['UNSAFE_URL_REMOVED']);
    if (!removed.document) throw new Error('Refused');
    expect(new HtmlDocumentCodec().export(removed.document).html).not.toContain('refresh');
    const redirected = new HtmlDocumentCodec().import({ html, css: '' }, 'page');
    expect(redirected.diagnostics).toEqual([]);
    if (!redirected.document) throw new Error('Refused');
    const codec = new HtmlDocumentCodec();
    const source = codec.export(redirected.document);
    expect(source.html).toContain('http-equiv="refresh"');
    const assembler = new HtmlDocumentAssembler(codec, new ContentPolicy());
    expect(assembler.build(source, 'page', true)).not.toContain('refresh');
    expect(assembler.build(source, 'page', false)).toContain('http-equiv="refresh"');
    expect(() => new CompilationGuard().output('<p onclick="x()">x</p>')).toThrow(
      'COMPILE_UNSAFE_OUTPUT',
    );
  });
});
