import { describe, expect, it } from 'vitest';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { CssDocumentCodec } from '../../../src/codecs/css';
import { EditorDocument } from '../../../src/core/document';
import type { DocumentNode, EditorDocumentData } from '../../../src/core/document';

const corpus = [
  '<!DOCTYPE html><html lang="pt-BR"><head><title>Campanha</title><style>@media (max-width:600px){.card{width:100%}} .card{mso-line-height-rule:exactly;color:#222}</style></head><body><table role="presentation"><tr><td class="card">Olá, {{contact.name}} &amp; João&nbsp;😀</td></tr></table><!--[if mso]><table><tr><td>Outlook</td></tr></table><![endif]--></body></html>',
  '<section data-custom="preservar"><details><summary>Mais</summary><p>Texto <strong>destacado</strong> e {{unsubscribe_url}}</p></details><!-- comentário comum --></section>',
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html><head><meta charset="utf-8"></head><body><p title="a &quot; b">E-mail</p></body></html>',
  '<div><!--[if !mso]><!--><p>Responsivo</p><!--<![endif]--></div>',
];

const find = (nodes: readonly DocumentNode[], tag: string): DocumentNode | undefined => {
  for (const node of nodes) {
    if (node.tag === tag) return node;
    const nested = find(node.children ?? [], tag);
    if (nested) return nested;
  }
  return undefined;
};

const changeText = (nodes: readonly DocumentNode[], id: string): readonly DocumentNode[] =>
  nodes.map((node) =>
    node.id === id
      ? { ...node, value: 'Novo texto 😀' }
      : node.children
        ? { ...node, children: changeText(node.children, id) }
        : node,
  );

describe('HtmlDocumentCodec corpus', () => {
  it('preserves safe stylesheet fragments without artificial head/body nodes', () => {
    const source = { html: '<style>.x{color:red}</style><div class="x">Olá</div>', css: '' };
    const codec = new HtmlDocumentCodec();
    const document = codec.import(source, 'page').document;
    expect(document?.nodes.map((node) => node.tag)).toEqual(['style', 'div']);
    expect(document && codec.export(document)).toEqual(source);
  });

  it('rejects serialization which would reparent safe but structurally inconsistent JSON', () => {
    const data: EditorDocumentData = {
      schemaVersion: 1,
      id: 'd',
      kind: 'page',
      revision: 0,
      title: '',
      css: '',
      nodes: [
        {
          id: 'p',
          type: 'element',
          tag: 'p',
          children: [
            {
              id: 'div',
              type: 'element',
              tag: 'div',
              children: [{ id: 'text', type: 'text', value: 'Preserve' }],
            },
          ],
        },
      ],
    };
    expect(() => new HtmlDocumentCodec().export(data)).toThrow('SERIALIZED_STRUCTURE_CHANGED');
  });
  it.each(corpus)('preserves source across twenty alternations: %s', (html) => {
    const codec = new HtmlDocumentCodec();
    const source = { html, css: '.custom{padding:12px;--brand:#123456}' };
    let previous: EditorDocumentData | undefined;
    for (let index = 0; index < 20; index++) {
      const imported = codec.import(source, 'email', previous);
      expect(imported.diagnostics).toEqual([]);
      expect(imported.document).toBeDefined();
      if (!imported.document) throw new Error('Missing document');
      expect(codec.export(imported.document)).toEqual(source);
      expect(imported.document.revision).toBe(index);
      previous = imported.document;
    }
  });

  it('retains doctype, head, unknown neighbors and conditional markup during visual edits', () => {
    const codec = new HtmlDocumentCodec();
    const input =
      '<!DOCTYPE html><html><head><title>Título</title><style>.unknown{letter-spacing:.1em}</style></head><body><p>Editar</p><table data-unknown="x"><tr><td>A&nbsp;B</td></tr></table><!--[if mso]><p>Condicional</p><![endif]--></body></html>';
    const imported = codec.import({ html: input, css: '' }, 'email');
    if (!imported.document) throw new Error(JSON.stringify(imported.diagnostics));
    const paragraph = find(imported.document.nodes, 'p');
    const id = paragraph?.children?.[0]?.id;
    if (!id) throw new Error('Missing paragraph');
    const edited = EditorDocument.from(imported.document).withChanges({
      nodes: changeText(imported.document.nodes, id),
    });
    const output = codec.export(edited.snapshot()).html;
    expect(output).toContain('<!DOCTYPE html>');
    expect(output).toContain('<style>.unknown{letter-spacing:.1em}</style>');
    expect(output).toContain('<table data-unknown="x"><tr><td>A&nbsp;B</td></tr></table>');
    expect(output).toContain('<!--[if mso]><p>Condicional</p><![endif]-->');
    expect(output).toContain('<p>Novo texto 😀</p>');
  });

  it('keeps fragments without artificial document wrappers and derives local IDs', () => {
    const imported = new HtmlDocumentCodec().import(
      { html: '<p id="node-trusted" data-editor-type="image">A</p>', css: '' },
      'page',
    );
    expect(imported.document?.nodes[0]?.tag).toBe('p');
    expect(imported.document?.nodes[0]?.id).not.toBe('node-trusted');
    expect(imported.document?.nodes[0]?.metadata?.blockType).toBe('text');
  });

  it('reconciles IDs from trusted structure across edits and insertions, never from HTML metadata', () => {
    const codec = new HtmlDocumentCodec();
    const first = codec.import({ html: '<p>One</p><p>Two</p>', css: '' }, 'page').document;
    if (!first) throw new Error('Missing first import');
    const second = codec.import(
      { html: '<p>New</p><p>One</p><p>Two</p>', css: '' },
      'page',
      first,
    ).document;
    expect(second?.nodes[1]?.id).toBe(first.nodes[0]?.id);
    expect(second?.nodes[2]?.id).toBe(first.nodes[1]?.id);
    const third = codec.import(
      { html: '<p>Changed</p><p>One</p><p>Two</p>', css: '' },
      'page',
      second,
    ).document;
    expect(third?.nodes[0]?.id).toBe(second?.nodes[0]?.id);
    expect(third?.nodes[0]?.children?.[0]?.id).toBe(second?.nodes[0]?.children?.[0]?.id);
  });

  it('retains safe content after JSON serialization and cache disposal', () => {
    const codec = new HtmlDocumentCodec();
    const source = corpus[0];
    if (!source) throw new Error('Missing corpus');
    const imported = codec.import({ html: source, css: '' }, 'email');
    if (!imported.document) throw new Error(JSON.stringify(imported.diagnostics));
    const portable: unknown = JSON.parse(JSON.stringify(imported.document));
    codec.clearCache();
    const output = codec.export(EditorDocument.from(portable).snapshot()).html;
    expect(output).toContain('<!DOCTYPE html>');
    expect(output).toContain('{{contact.name}}');
    expect(output).toContain('<!--[if mso]><table><tr><td>Outlook</td></tr></table><![endif]-->');
    expect(
      new HtmlDocumentCodec().import({ html: output, css: '' }, 'email').document,
    ).toBeDefined();
  });
});

describe('CssDocumentCodec', () => {
  it('updates only the property and preserves comments, unrelated values and custom CSS', () => {
    const codec = new CssDocumentCodec();
    const input =
      'color:red; /* brand comment */ padding: 12px; --brand: #123456; color:green !important';
    const output = codec.setDeclaration(input, 'color', '#102030');
    expect(output).toContain('/* brand comment */');
    expect(output).toContain('padding: 12px');
    expect(output).toContain('--brand: #123456');
    expect(codec.inspect(output, 'declarationList').declarations.color).toBe('#102030');
    // The replaced declaration was the one winning the cascade: its priority is kept.
    expect(output).toBe(
      '/* brand comment */ padding: 12px;--brand: #123456;color:#102030!important',
    );
  });

  it('rejects injected declarations rather than silently accepting a second property', () => {
    expect(() =>
      new CssDocumentCodec().setDeclaration('color:red', 'color', 'red;display:none'),
    ).toThrow('INVALID_STYLE_DECLARATION');
  });
});
