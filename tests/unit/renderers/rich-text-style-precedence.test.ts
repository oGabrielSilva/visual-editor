import { describe, expect, it } from 'vitest';
import { Extension, Mark, getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { DOMSerializer } from '@tiptap/pm/model';
import { defaultTreeAdapter, html, serialize } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { RichTextFormatting } from '../../../src/rich-text/formatting';
import { RICH_TEXT_ORIGIN_ATTRIBUTE } from '../../../src/core/rich-text-format';
import { EditorFactory } from '../../../src/composition/factory';
import { CssDocumentCodec } from '../../../src/codecs/css';
import type { DocumentNode } from '../../../src/core/document';

const formatting = new RichTextFormatting();
const originSpan = Mark.create({
  name: 'preservedSpan',
  excludes: '',
  parseHTML: () => [{ tag: 'span[data-editor-rich-origin]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
});
const origins = Extension.create({
  name: 'testOrigins',
  addGlobalAttributes: () => [
    {
      types: ['preservedSpan', 'bold', 'link', ...formatting.markNames()],
      attributes: {
        [RICH_TEXT_ORIGIN_ATTRIBUTE]: { default: null },
      },
    },
  ],
});
const schema = getSchema([
  StarterKit.configure({
    undoRedo: false,
    link: { HTMLAttributes: { target: null, rel: null, class: null } },
  }),
  ...formatting.styleExtensions(),
  originSpan,
  ...formatting.extensions(),
  origins,
]);

// The real ProseMirror serializer targets an inert parse5 tree without a browser DOM.
function serializeDocument(document: ReturnType<typeof schema.node>): string {
  type Parent = DefaultTreeAdapterMap['parentNode'];
  type Child = DefaultTreeAdapterMap['childNode'];
  const appendable = <T extends Parent>(node: T) =>
    Object.assign(node, {
      appendChild(child: Child) {
        defaultTreeAdapter.appendChild(node, child);
        return child;
      },
    });
  const createElement = (name: string) => {
    const node = appendable(defaultTreeAdapter.createElement(name, html.NS.HTML, []));
    return Object.assign(node, {
      nodeType: 1,
      setAttribute(key: string, value: string) {
        const previous = node.attrs.find((attribute) => attribute.name === key);
        if (previous) previous.value = String(value);
        else node.attrs.push({ name: key, value: String(value) });
      },
    });
  };
  const inertDocument = {
    createElement,
    createTextNode: defaultTreeAdapter.createTextNode,
    createDocumentFragment: () => appendable(defaultTreeAdapter.createDocumentFragment()),
  };
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(document.content, {
    document: inertDocument as unknown as Document,
  });
  return serialize(fragment as unknown as DefaultTreeAdapterMap['documentFragment']);
}

function all(nodes: readonly DocumentNode[]): readonly DocumentNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}
const css = new CssDocumentCodec();
function textRuns(
  nodes: readonly DocumentNode[],
  inherited: Readonly<Record<string, string>> = {},
): readonly { text: string; style: Readonly<Record<string, string>> }[] {
  return nodes.flatMap((node) => {
    const style = {
      ...inherited,
      ...css.inspect(node.attrs?.style ?? '', 'declarationList').declarations,
    };
    return node.type === 'text'
      ? [{ text: node.value ?? '', style }]
      : textRuns(node.children ?? [], style);
  });
}

const cases = [
  { tag: 'span', mark: 'preservedSpan' },
  { tag: 'strong', mark: 'bold' },
  { tag: 'a', mark: 'link' },
  { tag: 'strong', mark: formatting.markName('bold') },
] as const;

describe('explicit text style precedence over restored source attributes', () => {
  it('keeps style parsing non-consuming and ahead of generic origin spans', () => {
    const rules = schema.marks.textStyle?.spec.parseDOM;
    expect(rules?.[0]).toMatchObject({ consuming: false, priority: 60 });
    expect(schema.marks.preservedSpan?.spec.parseDOM?.[0]?.priority ?? 50).toBeLessThan(60);
  });

  it.each(cases)(
    'serializes a new style inside $mark and preserves it through domain commit/history',
    ({ tag, mark }) => {
      const factory = new EditorFactory(() => ({
        compile: async () => {
          throw new Error('NOT_USED');
        },
      }));
      const link = tag === 'a' ? ' href="https://example.test/original"' : '';
      const originalHtml = `<p style="font-family:Georgia;font-size:18px;line-height:22px"><${tag} id="source-identity" class="source-brand" title="Source title" style="color:#ff0000"${link}>Antes alvo depois</${tag}></p>`;
      const editor = factory.create({ source: { html: originalHtml, css: '' } });
      try {
        const original = editor.session.exportSource().html;
        const before = editor.session.snapshot();
        const source = all(before.nodes).find((node) => node.attrs?.id === 'source-identity');
        const paragraph = all(before.nodes).find((node) => node.tag === 'p');
        if (!source || !paragraph) throw new Error('MISSING_FIXTURE_NODE');
        const sourceMark = schema.mark(mark, {
          [RICH_TEXT_ORIGIN_ATTRIBUTE]: source.id,
          ...(mark === 'link' ? { href: 'https://example.test/original' } : {}),
        });
        const explicit = schema.mark('textStyle', {
          color: '#0000ff',
          fontFamily: 'Verdana',
          fontSize: '24px',
          lineHeight: '30px',
        });
        const document = schema.node('doc', null, [
          schema.node('paragraph', null, [
            schema.text('Antes ', [sourceMark]),
            schema.text('alvo', [sourceMark, explicit]),
            schema.text(' depois', [sourceMark]),
          ]),
        ]);
        expect(document.firstChild?.child(1).marks.map((value) => value.type.name)).toEqual([
          mark,
          'textStyle',
        ]);
        const serialized = serializeDocument(document);
        expect(editor.controller.beginRichText(paragraph.id)).toBe(true);
        expect(editor.controller.updateRichTextDraft(serialized)).toBe(true);
        expect(editor.controller.commitRichText()).toBe(true);
        const after = editor.session.snapshot();
        const runs = textRuns(after.nodes);
        expect(runs.map((run) => run.text)).toEqual(['Antes ', 'alvo', ' depois']);
        expect(runs.map((run) => run.style.color)).toEqual(['#ff0000', '#0000ff', '#ff0000']);
        expect(runs.map((run) => run.style['font-family'])).toEqual([
          'Georgia',
          'Verdana',
          'Georgia',
        ]);
        expect(runs.map((run) => run.style['font-size'])).toEqual(['18px', '24px', '18px']);
        expect(runs.map((run) => run.style['line-height'])).toEqual(['22px', '30px', '22px']);
        expect(
          all(after.nodes).filter((node) => node.attrs?.id === 'source-identity'),
        ).toHaveLength(1);
        expect(
          all(after.nodes).find((node) => node.attrs?.id === 'source-identity')?.attrs,
        ).toMatchObject({ class: 'source-brand', title: 'Source title' });
        const output = editor.session.exportSource().html;
        expect(output).not.toContain('data-editor-rich-');
        expect(editor.controller.undo()).toBe(true);
        expect(editor.session.exportSource().html).toBe(original);
        expect(editor.controller.redo()).toBe(true);
        expect(editor.session.exportSource().html).toBe(output);
      } finally {
        editor.dispose();
      }
    },
  );
});
