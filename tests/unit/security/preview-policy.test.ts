import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { HtmlDocumentAssembler, PreviewDocument } from '../../../src/renderers/preview-document';
import { SelectionPreviewRenderer } from '../../../src/renderers/selection-preview';
import { ContentPolicy } from '../../../src/security/policy';
import { EMAIL_HANDMADE, LANDING_PAGE } from '../fixtures/real-world';

type Element = DefaultTreeAdapterMap['element'];

const policy = new ContentPolicy();
const codec = new HtmlDocumentCodec(policy);
const assembler = new HtmlDocumentAssembler(codec, policy, ['https://assets.example.com']);

const elements = (html: string): Element[] => {
  const found: Element[] = [];
  const stack: DefaultTreeAdapterMap['parentNode'][] = [parse(html)];
  while (stack.length) {
    const parent = stack.pop();
    if (!parent) break;
    for (const node of parent.childNodes) {
      if (!('tagName' in node)) continue;
      found.push(node);
      stack.push('content' in node ? node.content : node);
    }
  }
  return found;
};
const attribute = (element: Element, name: string): string | undefined =>
  element.attrs.find((entry) => entry.name === name)?.value;
const policies = (html: string): string[] =>
  elements(html)
    .filter((element) => attribute(element, 'http-equiv')?.toLowerCase().includes('security'))
    .map((element) => attribute(element, 'content') ?? '');
const directives = (value: string): Map<string, string> =>
  new Map(
    value.split(';').map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name ?? '', sources.join(' ')];
    }),
  );

/** A page whose author tried everything which acts on the window that renders it. */
const hostile = LANDING_PAGE.replace(
  '<title>',
  '<meta http-equiv="Content-Security-Policy" content="script-src * \'unsafe-inline\'"><meta http-equiv="refresh" content="0;url=https://attacker.invalid"><meta http-equiv="Content-Security-Policy-Report-Only" content="default-src *"><base href="https://attacker.invalid/"><title>',
).replace('<main', '<meta http-equiv="REFRESH" content="1"><main');

describe('the policy of the editing frame', () => {
  const preview = assembler.build({ html: hostile, css: 'p{color:red}' }, 'page', true);

  it('lets nothing of the document run and loads the styles, fonts and images of the author', () => {
    const [own, ...others] = policies(preview);
    expect(others).toEqual([]);
    const policyDirectives = directives(own ?? '');
    expect(Object.fromEntries(policyDirectives)).toEqual({
      'default-src': "'none'",
      'style-src': "'unsafe-inline' https:",
      'font-src': 'https: data:',
      'media-src': 'https: data: blob:',
      'connect-src': "'none'",
      'frame-src': "'none'",
      'child-src': "'none'",
      'worker-src': "'none'",
      'manifest-src': "'none'",
      'form-action': "'none'",
      'base-uri': "'none'",
      'object-src': "'none'",
      'img-src': 'data: blob: https: https://assets.example.com',
    });
    // No script source at all here: scripts, handlers and javascript: URLs fall back to
    // default-src 'none'. Only the selection preview adds one nonce, for the editor script.
    expect(own).not.toContain('script-src');
    expect(own).not.toContain('unsafe-eval');
  });

  it('puts its policy before anything the document could run', () => {
    const head = elements(preview).find((element) => element.tagName === 'head');
    const first = head?.childNodes.find((node): node is Element => 'tagName' in node);
    expect(first && attribute(first, 'http-equiv')).toBe('Content-Security-Policy');
    expect(preview.indexOf('Content-Security-Policy')).toBeLessThan(preview.indexOf('<script'));
    expect(preview.indexOf('Content-Security-Policy')).toBeLessThan(preview.indexOf('<link'));
  });

  it('removes the refresh, the policies and the base of the author from the copy only', () => {
    const copied = elements(preview);
    expect(
      copied.filter((element) => attribute(element, 'http-equiv')?.toLowerCase() === 'refresh'),
    ).toEqual([]);
    expect(preview).not.toContain('attacker.invalid');
    expect(preview).not.toContain('script-src *');
    const bases = copied.filter((element) => element.tagName === 'base');
    // The elements keep their place, so the tree still maps onto the document; they are inert.
    expect(bases).toHaveLength(2);
    for (const base of bases) expect(base.attrs).toEqual([]);
    // The harmless directives and everything else of the author stay in the copy.
    expect(preview).toContain('http-equiv="X-UA-Compatible"');
    expect(preview).toContain('bootstrap.min.css');
    expect(preview).toContain('googletagmanager.com/gtm.js');
    // The document itself is untouched: what is exported still holds all of it.
    const exported = assembler.build({ html: hostile, css: '' }, 'page', false);
    expect(policies(exported)).toEqual(["script-src * 'unsafe-inline'", 'default-src *']);
    expect(exported).toContain('<base href="https://attacker.invalid/">');
    expect(exported).toContain('content="0;url=https://attacker.invalid"');
    const imported = codec.import({ html: hostile, css: '' }, 'page');
    expect(imported.document && codec.export(imported.document).html).toBe(hostile);
    expect(imported.document && policy.inspect(imported.document).metaRefresh).toBe(2);
  });

  it('applies the same policy through the plain preview document', () => {
    const html = new PreviewDocument(assembler).build({ html: hostile, css: '' }, 'page');
    expect(policies(html)).toHaveLength(1);
    expect(policies(html)[0]).toContain("default-src 'none'");
  });

  it('authorizes the editor script alone, by the digest of its text, in the selection preview', () => {
    const renderer = new SelectionPreviewRenderer(codec, policy, assembler);
    const imported = codec.import({ html: hostile, css: '' }, 'page');
    if (!imported.document) throw new Error('Refused');
    const selection = renderer.build(imported.document, 'Selecionar');
    const [own, ...others] = policies(selection.html);
    expect(others).toEqual([]);
    const scriptSource = directives(own ?? '').get('script-src') ?? '';
    expect(directives(own ?? '').get('default-src')).toBe("'none'");
    const scripts = elements(selection.html).filter((element) => element.tagName === 'script');
    // Six scripts of the page (the one inside the template included) and one of the editor.
    expect(scripts).toHaveLength(7);
    expect(scripts.map((script) => attribute(script, 'nonce')).filter(Boolean)).toEqual([]);
    const text = (script: Element): string =>
      script.childNodes.map((child) => ('value' in child ? child.value : '')).join('');
    const ownScript = scripts.filter((script) => text(script).includes(selection.nonce));
    expect(ownScript).toHaveLength(1);
    expect(ownScript[0]?.attrs).toEqual([]);
    // One source, the digest of exactly that text: nothing else of the window may run.
    expect(scriptSource).toBe(
      `'sha256-${createHash('sha256')
        .update(text(ownScript[0] as Element), 'utf8')
        .digest('base64')}'`,
    );
    // The text the browser digests is the text which was written: no character the parser of
    // the window would normalize or replace.
    for (const character of [String.fromCharCode(13), String.fromCharCode(0)])
      expect(text(ownScript[0] as Element).includes(character)).toBe(false);
    // The secret of the protocol sits in no attribute, where a style sheet could read it.
    for (const element of elements(selection.html))
      for (const entry of element.attrs)
        expect(entry.value.includes(selection.nonce), `${element.tagName}[${entry.name}]`).toBe(
          false,
        );
    expect(selection.html).not.toContain('attacker.invalid');
    // Handlers and javascript: URLs stay as attributes of the copy; without a nonce source
    // for them the policy refuses both (script-src-attr and navigation fall back to script-src).
    expect(selection.html).toContain('href="javascript:void(0)"');
    expect(own).not.toContain("'unsafe-inline' 'nonce");
    expect(own).not.toContain('unsafe-hashes');
    // An island of SVG is one node of the document: it is never annotated inside.
    const svg = elements(selection.html).find((element) => element.tagName === 'svg');
    expect(svg).toBeDefined();
    expect(selection.html).not.toContain('<path data-visual-editor');
    // The next revision reuses the window and carries no script of the editor.
    const update = renderer.update(imported.document, 'Selecionar', selection);
    expect(update.html).not.toContain(selection.nonce);
    expect(directives(policies(update.html)[0] ?? '').get('script-src')).toBe("'none'");
    expect(update.nonce).toBe(selection.nonce);
  });

  it('never lets annotations written inside an island reach the frame', () => {
    const renderer = new SelectionPreviewRenderer(codec, policy, assembler);
    const imported = codec.import(
      {
        html: '<p>Texto</p><svg><g data-visual-editor-node="forged" data-visual-editor-edit-node="forged"><text>x</text></g></svg>',
        css: '',
      },
      'page',
    );
    if (!imported.document) throw new Error('Refused');
    const selection = renderer.build(imported.document, 'Selecionar');
    expect(selection.html).not.toContain('forged');
    expect(selection.nodeIds).not.toContain('forged');
  });

  it('builds the frame of an e-mail from its cleaned form, whatever source it is given', () => {
    const html = assembler.build({ html: EMAIL_HANDMADE, css: '' }, 'email', true);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('v:roundrect');
    expect(policies(html)).toHaveLength(1);
  });
});
