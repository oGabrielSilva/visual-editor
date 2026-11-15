import { describe, expect, it } from 'vitest';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { EditorDocument } from '../../../src/core/document';
import type { DocumentKind, DocumentNode, EditorDocumentData } from '../../../src/core/document';
import { EditorFactory } from '../../../src/composition/factory';

const factory = new EditorFactory(() => ({
  async compile() {
    throw new Error('Not used by this fixture');
  },
}));

const structure = (node: DocumentNode): unknown => ({
  type: node.type,
  tag: node.tag,
  value: node.value,
  attrs: Object.entries(node.attrs ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  children: (node.children ?? []).map(structure),
});

const imported = (codec: HtmlDocumentCodec, html: string, kind: DocumentKind = 'page') => {
  const result = codec.import({ html, css: '' }, kind);
  if (!result.document) throw new Error(`Rejected fixture: ${JSON.stringify(result.diagnostics)}`);
  return result.document;
};

const textNode = (nodes: readonly DocumentNode[], value: string): DocumentNode => {
  for (const node of nodes) {
    if (node.type === 'text' && node.value === value) return node;
    if (node.children?.length) {
      try {
        return textNode(node.children, value);
      } catch {
        /* keep searching siblings */
      }
    }
  }
  throw new Error(`Missing text ${value}`);
};

const withText = (document: EditorDocumentData, id: string, value: string): EditorDocumentData => {
  const change = (nodes: readonly DocumentNode[]): readonly DocumentNode[] =>
    nodes.map((node) =>
      node.id === id
        ? { ...node, value }
        : node.children
          ? { ...node, children: change(node.children) }
          : node,
    );
  return { ...document, revision: document.revision + 1, nodes: change(document.nodes) };
};

/** Reopens the persisted JSON in a codec which never saw the original source. */
const exportWithoutSource = (document: EditorDocumentData): string => {
  const portable: unknown = JSON.parse(JSON.stringify(document));
  return new HtmlDocumentCodec().export(EditorDocument.from(portable).snapshot()).html;
};

const portableCorpus: readonly (readonly [DocumentKind, string])[] = [
  ['page', '<pre>\nprimeira linha</pre>'],
  ['page', '<pre>\n\nlinha após quebra preservada</pre>'],
  ['page', '<pre>sem quebra</pre><textarea>\n\ncampo</textarea><listing>\n\nlistagem</listing>'],
  ['page', '<p>antes</p><basefont color="red"><p>depois</p>'],
  ['page', '<p>som</p><bgsound src="https://example.com/a.mid"><keygen name="k"><p>fim</p>'],
  ['page', '<table><tr><td>cel</td></tr><div>fora</div></table><p>alvo</p>'],
  ['page', '<table><tr><td>cel</td></tr>solto</table><p>alvo</p>'],
  ['page', '<p><b>bold<p>next</p><p>alvo</p>'],
  ['page', '<div><font color="red"><p>um</p><p>dois</font></p><p>alvo</p></div>'],
  ['page', "<p title='x'  CLASS=a>caf&eacute; &copy;<BR/></p><p>alvo</p>"],
  [
    'page',
    '<ul><li>um<li>dois</ul><p>a &lt; b &amp; c</p><a href="https://example.com/?a=1&amp;b=2">x</a>',
  ],
  [
    'email',
    '<!DOCTYPE html><html><head><title>T</title></head><body><![if !mso]><p>fora do Outlook</p><![endif]><p>alvo</p>\n</body>\n</html>\n<!-- fim -->',
  ],
  [
    'email',
    '<!doctype html><html><head><meta http-equiv="Content-Type" content="text/html;charset=UTF-8"></head><body><table role="presentation"><tr><td>Olá</td></tr></table><!--[if mso]><p>Outlook</p><![endif]--></body></html>',
  ],
];

describe('serialization does not depend on the source cache', () => {
  it('keeps the line feed parse5 drops after pre, textarea and listing', () => {
    for (const html of [
      '<pre>\n\nlinha</pre>',
      '<textarea>\n\ncampo</textarea>',
      '<listing>\n\nlistagem</listing>',
    ]) {
      const document = imported(new HtmlDocumentCodec(), html);
      const output = exportWithoutSource(document);
      expect(output).toBe(html);
      expect(imported(new HtmlDocumentCodec(), output).nodes.map(structure)).toEqual(
        document.nodes.map(structure),
      );
    }
  });

  it('serializes every element the parser treats as void without cutting its start tag', () => {
    const document = imported(
      new HtmlDocumentCodec(),
      '<p>a</p><basefont color="red"><bgsound src="https://example.com/a.mid"><keygen name="k">',
    );
    const output = exportWithoutSource(document);
    expect(output).toContain('<basefont color="red">');
    expect(output).toContain('<bgsound src="https://example.com/a.mid">');
    expect(output).toContain('<keygen name="k">');
    expect(output).not.toContain('</basefont>');
  });

  it('refuses children for obsolete void elements in external JSON', () => {
    expect(() =>
      EditorDocument.from({
        schemaVersion: 1,
        id: 'd',
        kind: 'page',
        revision: 0,
        title: '',
        css: '',
        nodes: [
          {
            id: 'a',
            type: 'element',
            tag: 'basefont',
            children: [{ id: 'b', type: 'text', value: 'x' }],
          },
        ],
      }),
    ).toThrow('VOID_ELEMENT_CHILDREN');
  });

  it('exports every accepted source from its JSON alone and reimports the same structure', () => {
    for (const [kind, html] of portableCorpus) {
      const document = imported(new HtmlDocumentCodec(), html, kind);
      const output = exportWithoutSource(document);
      const again = imported(new HtmlDocumentCodec(), output, kind);
      expect(again.nodes.map(structure), html).toEqual(document.nodes.map(structure));
      // The serialized form is a fixed point: a second trip changes nothing.
      expect(exportWithoutSource(again), html).toBe(output);
    }
  });

  it('opens an editor from the persisted JSON of each accepted source', () => {
    for (const [kind, html] of portableCorpus) {
      const first = factory.create({ kind, source: { html, css: '' } });
      const json: unknown = JSON.parse(JSON.stringify(first.session.snapshot()));
      first.dispose();
      const reopened = factory.create({ document: EditorDocument.from(json).snapshot() });
      expect(reopened.session.snapshot().nodes.map(structure), html).toEqual(
        EditorDocument.from(json).snapshot().nodes.map(structure),
      );
      reopened.dispose();
    }
  });
});

describe('source slices are used only when self-contained', () => {
  const relocated = [
    '<table><tr><td>cel</td></tr><div>fora</div></table><p>alvo</p>',
    '<table><tr><td>cel</td></tr>solto</table><p>alvo</p>',
    '<p><b>bold<p>next</p><p>alvo</p>',
    '<div><font color="red"><p>um</p><p>dois</font></p><p>alvo</p></div>',
  ];

  it('accepts a visual edit after foster parenting or formatting reconstruction', () => {
    for (const html of relocated) {
      const { session } = factory.create({ source: { html, css: '' } });
      const target = textNode(session.snapshot().nodes, 'alvo');
      expect(session.updateText(target.id, 'editado'), html).toBe(true);
      expect(session.getState().diagnostics, html).toEqual([]);
      const output = session.exportSource().html;
      expect(output).toContain('editado');
      expect(imported(new HtmlDocumentCodec(), output).nodes.map(structure), html).toEqual(
        session.snapshot().nodes.map(structure),
      );
      session.dispose();
    }
  });

  it('still preserves the bytes of well-formed siblings, including an implied tbody', () => {
    const untouched =
      "<table  WIDTH=100% ><tr><td  align='center'>caf&eacute; &copy;</td></tr></table>";
    const codec = new HtmlDocumentCodec();
    const document = imported(codec, `${untouched}<p>alvo</p>`);
    const output = codec.export(
      withText(document, textNode(document.nodes, 'alvo').id, 'editado'),
    ).html;
    expect(output).toBe(`${untouched}<p>editado</p>`);
  });

  it('falls back to plain serialization when a preserved slice fails verification', () => {
    const codec = new HtmlDocumentCodec();
    const document = imported(codec, '<div><p>um</p></div><p>alvo</p>');
    const divId = document.nodes[0]?.id;
    // Same structure, different identity: the cached region no longer describes this node.
    const forged: EditorDocumentData = {
      ...withText(document, textNode(document.nodes, 'alvo').id, 'editado'),
      nodes: withText(document, textNode(document.nodes, 'alvo').id, 'editado').nodes.map((node) =>
        node.id === divId ? { ...node, attrs: { title: 'novo' } } : node,
      ),
    };
    expect(codec.export(forged).html).toBe('<div title="novo"><p>um</p></div><p>editado</p>');
  });
});

describe('merged trailing text never drags closing tags', () => {
  it('emits one body and html end tag after the first edit', () => {
    const html =
      '<!DOCTYPE html><html><head><title>T</title></head><body><p>alvo</p>\n</body>\n</html>\n<!-- fim -->';
    const { session } = factory.create({ kind: 'email', source: { html, css: '' } });
    expect(session.updateText(textNode(session.snapshot().nodes, 'alvo').id, 'editado')).toBe(true);
    const output = session.exportSource().html;
    expect(output.split('</body>')).toHaveLength(2);
    expect(output.split('</html>')).toHaveLength(2);
    expect(output).toContain('<p>editado</p>');
    expect(output).toContain('<!-- fim -->');
    session.dispose();
  });
});

describe('auxiliary imports do not evict the session source', () => {
  const preserved = "<p title='x'  CLASS=a>caf&eacute; &copy;<BR/></p>";

  it('keeps a record alive across more auxiliary imports than the cache holds', () => {
    const codec = new HtmlDocumentCodec(undefined, undefined, 2);
    const document = imported(codec, `${preserved}<p>alvo</p>`);
    for (let index = 0; index < 10; index += 1)
      expect(
        codec.inspect({ html: `<p>auxiliar ${index}</p>`, css: '' }, 'page').document,
      ).toBeDefined();
    const output = codec.export(
      withText(document, textNode(document.nodes, 'alvo').id, 'editado'),
    ).html;
    expect(output).toBe(`${preserved}<p>editado</p>`);
  });

  it('treats an exported record as the most recently used one', () => {
    const codec = new HtmlDocumentCodec(undefined, undefined, 2);
    const document = imported(codec, `${preserved}<p>alvo</p>`);
    const edited = withText(document, textNode(document.nodes, 'alvo').id, 'editado');
    for (let index = 0; index < 6; index += 1) {
      imported(codec, `<p>outro documento ${index}</p>`);
      expect(codec.export(edited).html).toBe(`${preserved}<p>editado</p>`);
    }
  });

  it('preserves untouched source bytes after a long rich text draft', () => {
    const { session } = factory.create({
      source: { html: `${preserved}<p>alvo</p>`, css: '' },
    });
    const target = session
      .snapshot()
      .nodes.find((node) => node.tag === 'p' && node.children?.[0]?.value === 'alvo');
    if (!target) throw new Error('Missing fixture paragraph');
    expect(session.beginRichText(target.id, 'alvo')).toBe(true);
    for (let key = 1; key <= 40; key += 1)
      expect(session.updateRichTextDraft(`alvo${'x'.repeat(key)}`)).toBe(true);
    expect(session.commitRichText()).toBe(true);
    expect(session.exportSource().html).toBe(`${preserved}<p>alvo${'x'.repeat(40)}</p>`);
    session.dispose();
  });
});
