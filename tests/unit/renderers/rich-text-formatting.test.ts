import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import type { MarkSpec } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { RichTextFormatting } from '../../../src/rich-text/formatting';
import {
  RICH_TEXT_FORMATS,
  RICH_TEXT_ORIGIN_ATTRIBUTE,
  RICH_TEXT_REMOVED_ATTRIBUTE,
} from '../../../src/core/rich-text-format';

const formatting = new RichTextFormatting();
const semantic: MarkSpec = { attrs: { [RICH_TEXT_ORIGIN_ATTRIBUTE]: { default: null } } };
const marks: Record<string, MarkSpec> = { preservedSpan: { ...semantic, excludes: '' } };
for (const format of RICH_TEXT_FORMATS) {
  marks[format] = semantic;
  marks[formatting.markName(format)] = {
    excludes: '',
    attrs: {
      [RICH_TEXT_ORIGIN_ATTRIBUTE]: { default: null },
      [RICH_TEXT_REMOVED_ATTRIBUTE]: { default: format },
    },
  };
}
const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', group: 'block' },
    text: { group: 'inline' },
  },
  marks,
});
const origin = (id: string) => ({ [RICH_TEXT_ORIGIN_ATTRIBUTE]: id });

function fixture() {
  return schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('AB', [
        schema.mark('preservedSpan', origin('outer')),
        schema.mark('bold', origin('first')),
      ]),
      schema.text('CD', [schema.mark('bold', origin('second'))]),
    ]),
  ]);
}

describe('independent semantic formatting provenance', () => {
  it('preserves each partial origin without replacing an unrelated nested span', () => {
    const document = fixture();
    const original = document.toJSON();
    const tr = EditorState.create({ doc: document, schema }).tr.setSelection(
      TextSelection.create(document, 2, 4),
    );
    expect(formatting.preserve(tr, 'bold')).toBe(true);
    tr.removeMark(2, 4, schema.marks.bold);
    const first = tr.doc.resolve(2).nodeAfter;
    const second = tr.doc.resolve(3).nodeAfter;
    expect(
      first?.marks.find((mark) => mark.type.name === 'preservedSpan')?.attrs[
        RICH_TEXT_ORIGIN_ATTRIBUTE
      ],
    ).toBe('outer');
    expect(
      first?.marks.find((mark) => mark.type.name === formatting.markName('bold'))?.attrs[
        RICH_TEXT_ORIGIN_ATTRIBUTE
      ],
    ).toBe('first');
    expect(
      second?.marks.find((mark) => mark.type.name === formatting.markName('bold'))?.attrs[
        RICH_TEXT_ORIGIN_ATTRIBUTE
      ],
    ).toBe('second');
    expect(first?.marks.some((mark) => mark.type.name === 'bold')).toBe(false);
    expect(tr.doc.textContent).toBe('ABCD');
    expect(document.toJSON()).toEqual(original);
  });

  it('reapplies the semantic origin and removes detached reset metadata', () => {
    const document = fixture();
    const tr = EditorState.create({ doc: document, schema }).tr.setSelection(
      TextSelection.create(document, 2, 4),
    );
    formatting.preserve(tr, 'bold');
    tr.removeMark(2, 4, schema.marks.bold);
    tr.addMark(2, 4, schema.mark('bold'));
    expect(formatting.restore(tr, 'bold')).toBe(true);
    expect(
      tr.doc.resolve(2).nodeAfter?.marks.find((mark) => mark.type.name === 'bold')?.attrs[
        RICH_TEXT_ORIGIN_ATTRIBUTE
      ],
    ).toBe('first');
    expect(
      tr.doc.resolve(3).nodeAfter?.marks.find((mark) => mark.type.name === 'bold')?.attrs[
        RICH_TEXT_ORIGIN_ATTRIBUTE
      ],
    ).toBe('second');
    tr.doc.nodesBetween(2, 4, (node) => {
      if (node.isText)
        expect(node.marks.some((mark) => mark.type.name === formatting.markName('bold'))).toBe(
          false,
        );
    });
  });

  it('uses stored marks at a collapsed caret without changing adjacent text', () => {
    const document = fixture();
    const tr = EditorState.create({ doc: document, schema }).tr.setSelection(
      TextSelection.create(document, 2),
    );
    formatting.preserve(tr, 'bold');
    tr.removeStoredMark(schema.marks.bold!);
    expect(tr.doc.eq(document)).toBe(true);
    expect(
      tr.storedMarks?.find((mark) => mark.type.name === formatting.markName('bold'))?.attrs[
        RICH_TEXT_ORIGIN_ATTRIBUTE
      ],
    ).toBe('first');
    tr.addStoredMark(schema.mark('bold'));
    formatting.restore(tr, 'bold');
    expect(
      tr.storedMarks?.find((mark) => mark.type.name === 'bold')?.attrs[RICH_TEXT_ORIGIN_ATTRIBUTE],
    ).toBe('first');
    expect(tr.storedMarks?.some((mark) => mark.type.name === formatting.markName('bold'))).toBe(
      false,
    );
  });

  it('restores a removed link origin while keeping the newly chosen link attributes', () => {
    const linkSchema = new Schema({
      nodes: schema.spec.nodes,
      marks: {
        ...marks,
        link: { attrs: { ...semantic.attrs, href: { default: '' }, target: { default: '_self' } } },
      },
    });
    const document = linkSchema.node('doc', null, [
      linkSchema.node('paragraph', null, [
        linkSchema.text('Link', [
          linkSchema.mark('link', { ...origin('anchor'), href: 'https://old.example' }),
        ]),
      ]),
    ]);
    const tr = EditorState.create({ doc: document, schema: linkSchema }).tr.setSelection(
      TextSelection.create(document, 1, 5),
    );
    formatting.preserve(tr, 'link');
    tr.removeMark(1, 5, linkSchema.marks.link);
    tr.addMark(1, 5, linkSchema.mark('link', { href: 'https://new.example', target: '_blank' }));
    formatting.restore(tr, 'link');
    const link = tr.doc.resolve(1).nodeAfter?.marks.find((mark) => mark.type.name === 'link');
    expect(link?.attrs).toMatchObject({
      ...origin('anchor'),
      href: 'https://new.example',
      target: '_blank',
    });
    expect(
      tr.doc
        .resolve(1)
        .nodeAfter?.marks.some((mark) => mark.type.name === formatting.markName('link')),
    ).toBe(false);
  });

  it.each(RICH_TEXT_FORMATS)(
    'keeps %s without an original marker as ordinary library formatting',
    (format) => {
      const document = schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('Text', [schema.mark(format)])]),
      ]);
      const tr = EditorState.create({ doc: document, schema }).tr.setSelection(
        TextSelection.create(document, 1, 5),
      );
      formatting.preserve(tr, format);
      expect(tr.doc.eq(document)).toBe(true);
      expect(tr.steps).toHaveLength(0);
    },
  );
});
