import { describe, expect, it } from 'vitest';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import type { EditorDocumentData } from '../../../src/core/document';
import { BoundedHtmlParser } from '../../../src/security/bounded-parser';
import { ContentPolicy } from '../../../src/security/policy';
import { RichTextProjection } from '../../../src/security/rich-text-projection';

const LEVELS = 50_000;
const deep = (tag: string, levels = LEVELS): string => `<${tag}>`.repeat(levels);

function timed<T>(run: () => T): { value: T; elapsed: number } {
  const start = performance.now();
  const value = run();
  return { value, elapsed: performance.now() - start };
}

describe('nesting is bounded while the source is parsed, not after', () => {
  for (const kind of ['page', 'email'] as const) {
    it(`refuses fifty thousand nested elements of a ${kind} in bounded time`, () => {
      const { value, elapsed } = timed(() =>
        new HtmlDocumentCodec().import({ html: deep('div'), css: '' }, kind),
      );
      expect(value.document).toBeUndefined();
      expect(value.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['DOCUMENT_TOO_DEEP']);
      expect(elapsed).toBeLessThan(2_000);
    });

    it(`refuses the same nesting hidden in source kept as text of a ${kind}`, () => {
      for (const html of [
        `<p>antes</p><noscript>${deep('div')}</noscript>`,
        `<p>antes</p><!--[if mso]>${deep('div')}<![endif]-->`,
        `<p>antes</p><template>${deep('div')}</template>`,
        `<p>antes</p><svg>${deep('g', 6_000)}</svg>`,
        `<p>antes</p><math>${deep('mrow', 6_000)}</math>`,
      ]) {
        const { value, elapsed } = timed(() =>
          new HtmlDocumentCodec().import({ html, css: '' }, kind),
        );
        expect(value.document, html.slice(0, 40)).toBeUndefined();
        expect(
          value.diagnostics.map((diagnostic) => diagnostic.code),
          html.slice(0, 40),
        ).toEqual(['DOCUMENT_TOO_DEEP']);
        expect(elapsed, html.slice(0, 40)).toBeLessThan(2_000);
      }
    });
  }

  it('keeps what nests within the limit exactly as the plain parser reads it', () => {
    const codec = new HtmlDocumentCodec();
    const html = `${'<div>'.repeat(200)}fim${'</div>'.repeat(200)}<svg>${'<g>'.repeat(200)}<path d="M0 0"/>${'</g>'.repeat(200)}</svg>`;
    const imported = codec.import({ html, css: '' }, 'page');
    expect(imported.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(imported.document && codec.export(imported.document).html).toBe(html);
    // Unclosed paragraphs are siblings, not nesting: thousands of them are an ordinary document.
    const wide = codec.import({ html: '<p>linha'.repeat(5_200), css: '' }, 'page');
    expect(wide.document).toBeDefined();
  });

  it('reports a document whose kept source nests too deep instead of throwing', () => {
    const codec = new HtmlDocumentCodec();
    const imported = codec.import({ html: '<p>a</p><noscript>x</noscript>', css: '' }, 'page');
    if (!imported.document) throw new Error('fixture');
    const hostile: EditorDocumentData = {
      ...imported.document,
      nodes: imported.document.nodes.map((node) =>
        node.tag === 'noscript'
          ? {
              ...node,
              children: [{ id: `${node.id}-source`, type: 'text', value: deep('div', 2_000) }],
            }
          : node,
      ),
    };
    const codes = new ContentPolicy()
      .validate(hostile)
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => diagnostic.code);
    expect(codes).toEqual(['DOCUMENT_TOO_DEEP']);
  });

  it('ends the parse of a text projection which nests beyond what a text may', () => {
    const { elapsed } = timed(() =>
      expect(() => new RichTextProjection().project(deep('b', 40_000))).toThrow(
        'RICH_TEXT_TOO_COMPLEX',
      ),
    );
    expect(elapsed).toBeLessThan(2_000);
  });

  it('counts the content of a template from the template which owns it', () => {
    const parser = new BoundedHtmlParser(8);
    expect(() => parser.fragment(`<template>${deep('div', 6)}</template>`)).not.toThrow();
    expect(() => parser.fragment(`<template>${deep('div', 40)}</template>`)).toThrow(
      'DOCUMENT_TOO_DEEP',
    );
  });
});

describe('identities are reconciled in one pass', () => {
  it('reimports thousands of identical nodes in time close to a clean import', () => {
    const codec = new HtmlDocumentCodec();
    const html = '<br>'.repeat(45_000);
    const clean = timed(() => codec.import({ html, css: '' }, 'page'));
    if (!clean.value.document) throw new Error('fixture');
    const previous = clean.value.document;
    const again = timed(() =>
      codec.import({ html: `${html}<p>fim</p>`, css: '' }, 'page', previous),
    );
    expect(again.value.document?.id).toBe(previous.id);
    const ids = new Set((again.value.document?.nodes ?? []).map((node) => node.id));
    expect(ids.size).toBe(45_001);
    for (const node of previous.nodes) expect(ids.has(node.id)).toBe(true);
    // Validating the previous document too costs about twice a clean import; the scan of every
    // earlier candidate for each node cost five times and more.
    expect(again.elapsed).toBeLessThan(clean.elapsed * 3.3 + 300);
  }, 30_000);
});
