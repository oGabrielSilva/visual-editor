import { describe, expect, it } from 'vitest';
import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import type { DocumentNode } from '../../../src/core/document';
import { ElementSourceMap } from '../../../src/renderers/element-source';
import { HtmlDocumentAssembler } from '../../../src/renderers/preview-document';
import {
  PREVIEW_FRAMESET,
  SelectionPreviewRenderer,
} from '../../../src/renderers/selection-preview';
import { ContentPolicy } from '../../../src/security/policy';

type Element = DefaultTreeAdapterMap['element'];

const policy = new ContentPolicy();
const codec = new HtmlDocumentCodec(policy);
const assembler = new HtmlDocumentAssembler(codec, policy);
const renderer = new SelectionPreviewRenderer(codec, policy, assembler);

/** Every element a parser builds, read with or without scripting, template contents included. */
const elements = (html: string, scriptingEnabled: boolean): Element[] => {
  const found: Element[] = [];
  const stack: DefaultTreeAdapterMap['parentNode'][] = [parse(html, { scriptingEnabled })];
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
const refreshes = (html: string, scripting: boolean): Element[] =>
  elements(html, scripting).filter(
    (element) =>
      element.tagName === 'meta' && attribute(element, 'http-equiv')?.toLowerCase() === 'refresh',
  );
const document = (html: string, kind: 'page' | 'email' = 'page') => {
  const imported = codec.import({ html, css: '' }, kind);
  if (!imported.document) throw new Error(`Refused: ${imported.diagnostics[0]?.code}`);
  return imported.document;
};

const NOSCRIPT =
  '<body><p>oi</p><noscript><meta http-equiv="refresh" content="0;url=https://evil.example/"><base href="https://evil.example/"><p data-visual-editor-node="forged" data-visual-editor-edit-node="forged">x</p><noscript><meta http-equiv="Refresh" content="1"></noscript></noscript></body>';

describe('markup which only a parser without scripting reads as elements', () => {
  for (const kind of ['page', 'email'] as const) {
    it(`leaves no refresh, base address or forged mark inside noscript of a ${kind}`, () => {
      const source = { html: NOSCRIPT, css: '' };
      const copy = assembler.build(source, kind, true);
      // The editing frame reads with scripting, the plain preview and the morph without.
      for (const scripting of [true, false]) {
        expect(refreshes(copy, scripting), String(scripting)).toEqual([]);
        for (const element of elements(copy, scripting)) {
          if (element.tagName === 'base') expect(attribute(element, 'href')).toBeUndefined();
          for (const entry of element.attrs)
            expect(entry.name.startsWith('data-visual-editor-'), entry.name).toBe(false);
        }
      }
      // What a reader without scripting is meant to see is still there.
      expect(elements(copy, false).some((element) => attribute(element, 'content') === '1')).toBe(
        false,
      );
      expect(copy).toContain('<noscript>');
      const selection = renderer.build(document(NOSCRIPT, kind), 'Selecionar');
      for (const scripting of [true, false]) {
        expect(refreshes(selection.html, scripting)).toEqual([]);
        const marks = elements(selection.html, scripting).flatMap((element) =>
          element.attrs.filter((entry) => entry.name.startsWith('data-visual-editor-')),
        );
        expect(marks.map((entry) => entry.value)).not.toContain('forged');
        for (const mark of marks.filter((entry) => entry.name === 'data-visual-editor-node'))
          expect(selection.nodeIds).toContain(mark.value);
      }
      const update = renderer.update(document(NOSCRIPT, kind), 'Selecionar', selection);
      expect(refreshes(update.html, false)).toEqual([]);
      expect(update.html).not.toContain('forged');
    });
  }

  it('keeps the document itself as it was written', () => {
    const exported = assembler.build({ html: NOSCRIPT, css: '' }, 'page', false);
    expect(refreshes(exported, false)).toHaveLength(2);
    expect(codec.export(document(NOSCRIPT)).html).toBe(NOSCRIPT);
  });

  it('strips marks forged inside the content of a template', () => {
    const selection = renderer.build(
      document('<p>a</p><template><p data-visual-editor-node="forged">x</p></template>'),
      'Selecionar',
    );
    expect(selection.html).not.toContain('forged');
  });
});

describe('a piece which cannot be drawn says why instead of throwing something else', () => {
  it('imports a page made of frames and names it when asked for the editing preview', () => {
    const page = document(
      '<!doctype html><html><head><title>Quadros</title></head><frameset cols="50%,50%"><frame src="a.html"><frame src="b.html"></frameset></html>',
    );
    expect(() => renderer.build(page, 'Selecionar')).toThrow(PREVIEW_FRAMESET);
    // The plain preview and the export still work: the content was never refused.
    expect(assembler.build(codec.export(page), 'page', true)).toContain('<frameset');
    expect(codec.export(page).html).toContain('<frame src="a.html">');
  });

  it('draws an island which nests as deep as a document may', () => {
    const svg = `<p>antes</p><svg>${'<g>'.repeat(240)}<path d="M0 0"/>${'</g>'.repeat(240)}</svg><p>depois</p>`;
    const selection = renderer.build(document(svg), 'Selecionar');
    expect(selection.html).toContain('<path d="M0 0"');
    expect(selection.nodeIds.length).toBeGreaterThanOrEqual(2);
  });
});

describe('one rule pairs the markup with the document', () => {
  const html =
    '<div><p>antes</p><svg viewBox="0 0 1 1"><g><path d="M0 0"/></g><foreignObject><p>dentro</p></foreignObject></svg><p>depois</p><math><mi>x</mi></math><h2>fim</h2></div>';
  const page = document(html);
  const source = codec.export(page);
  const all: DocumentNode[] = [];
  const collect = (nodes: readonly DocumentNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'element') all.push(node);
      collect(node.children ?? []);
    }
  };
  collect(page.nodes);

  it('finds the source of every element, before and after inline SVG and MathML', () => {
    const sources = new ElementSourceMap();
    expect(all.map((node) => node.tag)).toEqual(['div', 'p', 'svg', 'p', 'math', 'h2']);
    const read = Object.fromEntries(
      all.map((node) => [`${node.tag}:${node.id}`, sources.read(page, source, node.id)]),
    );
    expect(Object.values(read)).toEqual([
      html,
      '<p>antes</p>',
      '<svg viewBox="0 0 1 1"><g><path d="M0 0"/></g><foreignObject><p>dentro</p></foreignObject></svg>',
      '<p>depois</p>',
      '<math><mi>x</mi></math>',
      '<h2>fim</h2>',
    ]);
    const heading = all.at(-1);
    if (!heading) throw new Error('fixture');
    expect(sources.replace(page, source, heading.id, '<h3>novo</h3>')?.html).toBe(
      html.replace('<h2>fim</h2>', '<h3>novo</h3>'),
    );
  });

  it('marks in the preview exactly the blocks the same rule finds', () => {
    const selection = renderer.build(page, 'Selecionar');
    for (const id of selection.nodeIds) expect(renderer.elementSource(page, id), id).toBeDefined();
    expect(selection.nodeIds.length).toBeGreaterThanOrEqual(4);
  });
});
