import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { parseFragment } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { EditorFactory } from '../../../src/composition/factory';
import type { DocumentNode } from '../../../src/core/document';
import { RichTextDocumentBuilder } from '../../../src/rich-text/document-builder';
import type { RichTextJsonNode, RichTextSourceNode } from '../../../src/rich-text/document-builder';
import { RichTextProjectionExporter } from '../../../src/rich-text/projection-export';
import { RichTextProjectionRules } from '../../../src/rich-text/projection-rules';
import { RICH_TEXT_IMPLICIT_ATTRIBUTE, RichTextSchema } from '../../../src/rich-text/schema';

const factory = new EditorFactory(() => ({
  compile: async () => {
    throw new Error('NOT_USED');
  },
}));
const rules = new RichTextProjectionRules();
const kit = new RichTextSchema();
const schemas = {
  blocks: getSchema(
    kit.extensions({ content: 'block+', links: true, isAllowedUri: () => true, fidelity: true }),
  ),
  inline: getSchema(
    kit.extensions({ content: 'inline*', links: true, isAllowedUri: () => true, fidelity: true }),
  ),
};

/** What the frame runtime reads from the real element, taken here from the document node. */
function source(node: DocumentNode): RichTextSourceNode {
  if (node.type === 'text') return { type: 'text', text: node.value ?? '' };
  if (node.type !== 'element') return { type: 'other' };
  const tag = node.tag ?? '';
  return {
    type: 'element',
    tag,
    ...(rules.needsOrigin(tag, Object.keys(node.attrs ?? {})) ? { origin: node.id } : {}),
    attributes: { ...node.attrs },
    children: (node.children ?? []).map(source),
  };
}

function explicit(node: RichTextJsonNode): RichTextJsonNode {
  return {
    ...node,
    ...(node.attrs ? { attrs: { ...node.attrs, [RICH_TEXT_IMPLICIT_ATTRIBUTE]: false } } : {}),
    ...(node.content ? { content: node.content.map(explicit) } : {}),
  };
}

interface Leaf {
  readonly blocks: string;
  readonly marks: readonly string[];
  text: string;
}

/**
 * Attribute order is not part of the projection, and the editor schema nests marks by its own
 * rank (as the panel editor always did): compare each run of text with its blocks and its set
 * of marks, not the order in which the marks wrap it.
 */
function canonical(html: string): Leaf[] {
  const leaves: Leaf[] = [];
  const describe = (node: DefaultTreeAdapterMap['element']): string =>
    `${node.tagName}${node.attrs
      .map((attribute) => ` ${attribute.name}=${JSON.stringify(attribute.value)}`)
      .sort()
      .join('')}`;
  const visit = (
    nodes: readonly DefaultTreeAdapterMap['childNode'][],
    blocks: string,
    marks: readonly string[],
  ): void => {
    let block = 0;
    for (const node of nodes) {
      if (node.nodeName === '#text' && 'value' in node) {
        const previous = leaves.at(-1);
        const sorted = [...marks].sort();
        if (previous?.blocks === blocks && previous.marks.join('|') === sorted.join('|'))
          previous.text += node.value;
        else leaves.push({ blocks, marks: sorted, text: node.value });
      } else if ('tagName' in node) {
        if (rules.isBlock(node.tagName))
          visit(node.childNodes, `${blocks}/${describe(node)}#${block++}`, marks);
        else if (node.tagName === 'br')
          leaves.push({ blocks, marks: [...marks, describe(node)].sort(), text: '' });
        else visit(node.childNodes, blocks, [...marks, describe(node)]);
      }
    }
  };
  visit(parseFragment(html).childNodes, '', []);
  return leaves;
}

const corpus = [
  '<h1 style="color:#12645c">Título <em>com ênfase</em></h1>',
  '<p>Olá <strong class="native-mark">Nico Robin</strong> e <a href="https://example.test/" target="_blank" rel="noopener">converse</a>.</p>',
  '<p><span class="brand" style="color:#12645c">A<b>B</b></span><br>linha <i>dois</i> <small>pequeno</small> x<sup>2</sup> H<sub>2</sub>O <u>u</u> <s>s</s> <code>c</code></p>',
  '<p>a &amp; b &lt; c &quot;aspas&quot;  fim</p>',
  '<div data-editor-block="text">Texto solto com <strong>marca</strong></div>',
  '<div><p style="margin:0">Primeiro</p><ul><li>Um</li><li class="x">Dois <em>itálico</em></li></ul><ol start="3"><li><p>Três</p></li></ol><h2 id="sub">Subtítulo</h2><blockquote><p>Citação</p></blockquote><hr><p>Fim</p></div>',
  '<table><tbody><tr><td style="padding:20px">Texto solto na célula <a href="https://example.test/x" style="color:red">link</a></td></tr></tbody></table>',
  '<table><tbody><tr><td>antes<p>meio</p>depois <b>forte</b></td></tr></tbody></table>',
  '<footer>Rodapé com <a href="mailto:contato@example.test">contato</a></footer>',
  '<a href="https://example.test/acao" style="display:inline-block;color:#fff">Quero participar</a>',
];

describe('host projection and frame export agree for unedited text', () => {
  for (const html of corpus)
    it(`projects ${html.slice(0, 48)}`, () => {
      const editor = factory.create({ source: { html: `<main>${html}</main>`, css: '' } });
      try {
        const regions = editor.controller.canvasRegions().filter((region) => region.editable);
        expect(regions.length).toBeGreaterThan(0);
        for (const region of regions) {
          const host = editor.controller.richTextFor(region.id);
          if (host === undefined) throw new Error('MISSING_HOST_PROJECTION');
          const blocks = editor.controller.richTextAllowsBlocksFor(region.id);
          const schema = blocks ? schemas.blocks : schemas.inline;
          const json = new RichTextDocumentBuilder().build(
            (region.node.children ?? []).map(source),
            blocks,
            { markOrder: Object.keys(schema.marks), collapse: true },
          );
          if (!json) throw new Error('UNSUPPORTED_SOURCE');
          const exporter = new RichTextProjectionExporter(schema);
          const document = schema.nodeFromJSON(json);
          document.check();
          // With loose text wrapped as the host wraps it, both sides are the same projection.
          const wrapped = schema.nodeFromJSON(explicit(json));
          expect(canonical(exporter.export(wrapped))).toEqual(canonical(host));
          // As exported, loose text stays loose; the session accepts it and nothing changes.
          const exported = exporter.export(document);
          expect(exported).not.toContain('raw');
          const before = editor.session.exportSource().html;
          expect(editor.controller.beginRichText(region.id)).toBe(true);
          expect(editor.controller.updateRichTextDraft(exported)).toBe(true);
          expect(editor.controller.commitRichText()).toBe(true);
          const after = editor.session.exportSource().html;
          if (exported === host) expect(after).toBe(before);
          else expect(canonical(after)).toEqual(canonical(before));
        }
      } finally {
        editor.dispose();
      }
    });

  const order = { markOrder: Object.keys(schemas.inline.marks), collapse: true };
  const element = (
    tag: string,
    children: RichTextSourceNode[],
    attributes: Record<string, string> = {},
    origin?: string,
  ): RichTextSourceNode => ({
    type: 'element',
    tag,
    attributes,
    children,
    ...(origin ? { origin } : {}),
  });
  const text = (value: string): RichTextSourceNode => ({ type: 'text', text: value });

  it('refuses markup outside the projection instead of guessing', () => {
    const builder = new RichTextDocumentBuilder();
    expect(builder.build([{ type: 'other' }], true, order)).toBeUndefined();
    expect(builder.build([element('img', [], { src: 'x' })], true, order)).toBeUndefined();
    expect(builder.build([element('p', [])], false, order)).toBeUndefined();
    expect(builder.build([element('a', [])], false, order)).toBeUndefined();
  });

  it('keeps a span which wraps a link outside it, as one mark over the whole run', () => {
    const json = new RichTextDocumentBuilder().build(
      [
        element(
          'span',
          [
            text('Texto '),
            element('a', [text('link')], { href: 'https://example.test/' }, 'a1'),
            text(' mais'),
          ],
          { style: 'color:#666' },
          's1',
        ),
      ],
      false,
      order,
    );
    if (!json) throw new Error('UNSUPPORTED_SOURCE');
    const document = schemas.inline.nodeFromJSON(json);
    document.check();
    const names = (index: number): string[] =>
      document.child(index).marks.map((mark) => mark.type.name);
    expect(names(0)).toEqual(['preservedOuterSpan']);
    // Outermost first: the span still wraps the link, so the link keeps its own color.
    expect(names(1)).toEqual(['preservedOuterSpan', 'link']);
    expect(names(2)).toEqual(['preservedOuterSpan']);
    const exported = new RichTextProjectionExporter(schemas.inline).export(document);
    expect(exported.startsWith('<p><span data-editor-rich-origin="s1">Texto <a ')).toBe(true);
    expect(exported.endsWith('>link</a> mais</span></p>')).toBe(true);
  });

  it('refuses nestings the schema would rearrange instead of changing how they look', () => {
    const builder = new RichTextDocumentBuilder();
    const link = (children: RichTextSourceNode[]): RichTextSourceNode =>
      element('a', children, { href: 'https://example.test/' }, 'a1');
    // A link inside bold, a span between a link and a bold, and anything combined with code.
    expect(builder.build([element('strong', [link([text('x')])])], false, order)).toBeUndefined();
    expect(
      builder.build(
        [link([element('span', [element('strong', [text('x')])], { class: 'c' }, 's1')])],
        false,
        order,
      ),
    ).toBeUndefined();
    expect(builder.build([link([element('code', [text('x')])])], false, order)).toBeUndefined();
    expect(
      builder.build([element('pre', [element('b', [text('x')], {}, 'b1')])], true, {
        ...order,
        markOrder: Object.keys(schemas.blocks.marks),
      }),
    ).toBeUndefined();
    // The same marks in the order the schema renders are accepted.
    expect(builder.build([link([element('strong', [text('x')])])], false, order)).toBeDefined();
  });

  it('sets a terminal break and collapsible edge spacing aside and returns both on export', () => {
    const builder = new RichTextDocumentBuilder();
    const exporter = new RichTextProjectionExporter(schemas.inline);
    const build = (children: RichTextSourceNode[], collapse = true) => {
      const json = builder.build(children, false, { ...order, collapse });
      if (!json) throw new Error('UNSUPPORTED_SOURCE');
      const document = schemas.inline.nodeFromJSON(json);
      document.check();
      return document;
    };
    const breaks = build([text('Linha 1'), element('br', []), text('Linha 2'), element('br', [])]);
    expect(breaks.lastChild?.isText).toBe(true);
    expect(exporter.export(breaks)).toBe('<p>Linha 1<br>Linha 2<br></p>');
    const indented = build([text('\n    Olá'), element('strong', [text('!')]), text('\n  ')]);
    expect(indented.textContent).toBe('Olá!');
    expect(exporter.export(indented)).toBe('<p>\n    Olá<strong>!</strong>\n  </p>');
    // Preformatted spacing is content, not formatting of the source.
    expect(build([text('  a  ')], false).textContent).toBe('  a  ');
  });

  it('keeps source attributes for the view and never in what is exported', () => {
    const json = new RichTextDocumentBuilder().build(
      [
        {
          type: 'element',
          tag: 'b',
          origin: 'node-1',
          attributes: { class: 'brand', onclick: 'steal()', style: 'color:red' },
          children: [{ type: 'text', text: 'Texto' }],
        },
      ],
      false,
      order,
    );
    if (!json) throw new Error('UNSUPPORTED_SOURCE');
    const schema = getSchema(
      kit.extensions({ content: 'inline*', links: true, isAllowedUri: () => true, fidelity: true }),
    );
    const exporter = new RichTextProjectionExporter(schema);
    kit.applyFidelity(schema);
    const document = schema.nodeFromJSON(json);
    expect(exporter.export(document)).toBe(
      '<p><strong data-editor-rich-origin="node-1">Texto</strong></p>',
    );
    const mark = document.firstChild?.marks[0];
    if (!mark) throw new Error('MISSING_MARK');
    expect(mark.type.spec.toDOM?.(mark, true)).toEqual([
      'b',
      {
        class: 'brand',
        onclick: 'steal()',
        style: 'color:red',
        'data-visual-editor-text-origin': 'node-1',
      },
      0,
    ]);
  });
});
