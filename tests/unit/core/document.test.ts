import { describe, expect, it } from 'vitest';
import { EditorDocument } from '../../../src/core/document';
import type { EditorDocumentData } from '../../../src/core/document';
import { DocumentHistory } from '../../../src/core/history';
import { BlockCatalog } from '../../../src/core/catalog';

const fixture = (): EditorDocumentData => ({
  schemaVersion: 1,
  id: 'document',
  kind: 'page',
  revision: 0,
  title: 'Título',
  css: '',
  nodes: [
    {
      id: 'p',
      type: 'element',
      tag: 'p',
      attrs: { class: 'known' },
      children: [{ id: 'text', type: 'text', value: 'Original' }],
    },
  ],
});

describe('EditorDocument aggregate', () => {
  it('canonicalizes adjacent text without losing content or trusting stale source regions', () => {
    const input: EditorDocumentData = {
      ...fixture(),
      nodes: [
        {
          id: 'p',
          type: 'element',
          tag: 'p',
          children: [
            {
              id: 'first',
              type: 'text',
              value: 'Hello ',
              metadata: { sourceStart: 0, sourceEnd: 6 },
            },
            { id: 'empty', type: 'text', value: '' },
            {
              id: 'second',
              type: 'text',
              value: 'world',
              metadata: { sourceStart: 8, sourceEnd: 13 },
            },
          ],
        },
      ],
    };
    const normalized = EditorDocument.from(input).snapshot();
    expect(normalized.nodes[0]?.children).toEqual([
      { id: 'first', type: 'text', value: 'Hello world' },
    ]);
    expect(input.nodes[0]?.children).toHaveLength(3);
    expect(() =>
      EditorDocument.from({
        ...fixture(),
        nodes: [
          { id: 'first', type: 'text', value: 'x'.repeat(1_000_001) },
          { id: 'second', type: 'text', value: 'y'.repeat(1_000_001) },
        ],
      }),
    ).toThrow('DOCUMENT_TOO_LARGE');
  });
  it('does not expose or retain a mutable input reference', () => {
    const input = fixture();
    const document = EditorDocument.from(input);
    const snapshot = document.snapshot();
    const mutated = structuredClone(snapshot);
    Object.assign(mutated.nodes[0]?.attrs ?? {}, { class: 'changed' });
    Object.assign(input.nodes[0]?.attrs ?? {}, { class: 'input changed' });
    expect(document.snapshot().nodes[0]?.attrs?.class).toBe('known');
  });

  it('creates revisions without mutating the previous aggregate', () => {
    const document = EditorDocument.from(fixture());
    const next = document.withChanges({ title: 'Changed' });
    expect(next.revision).toBe(1);
    expect(document.snapshot().title).toBe('Título');
    expect(next.withRevision(10).revision).toBe(10);
  });

  it('rejects cyclic, excessive, duplicate and malformed external DTOs', () => {
    const cycle: Record<string, unknown> = { ...fixture() };
    cycle.self = cycle;
    expect(() => EditorDocument.from(cycle)).toThrow('CYCLIC_DOCUMENT');
    expect(() => EditorDocument.from({ ...fixture(), extra: true })).toThrow(
      'INVALID_DOCUMENT_SCHEMA',
    );
    expect(() =>
      EditorDocument.from({ ...fixture(), nodes: [fixture().nodes[0], fixture().nodes[0]] }),
    ).toThrow('DUPLICATE_NODE_ID');
    expect(() => EditorDocument.from({ ...fixture(), revision: -1 })).toThrow();
    expect(() =>
      EditorDocument.from({ ...fixture(), nodes: [{ id: 'a', type: 'element' }] }),
    ).toThrow('INVALID_ELEMENT');
    expect(() =>
      EditorDocument.from({
        ...fixture(),
        nodes: [
          {
            id: 'a',
            type: 'element',
            tag: 'img',
            children: [{ id: 'x', type: 'text', value: 'Must not disappear' }],
          },
        ],
      }),
    ).toThrow('VOID_ELEMENT_CHILDREN');
    expect(() =>
      EditorDocument.from({
        ...fixture(),
        nodes: [
          {
            id: 'a',
            type: 'element',
            tag: 'a',
            attrs: { href: 'https://one.invalid', HREF: 'https://two.invalid' },
          },
        ],
      }),
    ).toThrow('AMBIGUOUS_HTML_ATTRIBUTES');
  });
});

describe('DocumentHistory', () => {
  it('limits entries and removes only the abandoned redo branch', () => {
    const history = new DocumentHistory(3);
    let document = EditorDocument.from(fixture());
    history.push(document);
    for (let index = 0; index < 4; index++) {
      document = document.withChanges({ title: String(index) });
      history.push(document);
    }
    expect(history.size).toBe(3);
    expect(history.undo()?.snapshot().title).toBe('2');
    expect(history.canRedo).toBe(true);
    history.push(document.withChanges({ title: 'Branch' }));
    expect(history.canRedo).toBe(false);
    expect(history.current()?.snapshot().title).toBe('Branch');
  });

  it('isolates histories and resets all references', () => {
    const left = new DocumentHistory();
    const right = new DocumentHistory();
    left.push(EditorDocument.from(fixture()));
    left.push(EditorDocument.from(fixture()).withChanges({ title: 'Left' }));
    right.push(EditorDocument.from(fixture()).withChanges({ title: 'Right' }));
    expect(left.undo()?.snapshot().title).toBe('Título');
    expect(right.canUndo).toBe(false);
    expect(right.current()?.snapshot().title).toBe('Right');
    left.reset();
    expect(left.size).toBe(0);
    expect(left.current()).toBeUndefined();
  });
});

describe('BlockCatalog', () => {
  it('derives controls from structure rather than trusting metadata', () => {
    const catalog = new BlockCatalog();
    expect(
      catalog.recognize({
        id: 'unknown',
        type: 'element',
        tag: 'table',
        metadata: { blockType: 'heading' },
      }),
    ).toBeUndefined();
    expect(catalog.recognize({ id: 'heading', type: 'element', tag: 'h1' })?.type).toBe('heading');
    expect(() => catalog.create('form', 'form', 'email')).toThrow('BLOCK_NOT_SUPPORTED_FOR_KIND');
  });

  it('limits text editing and insertion to supported structural capabilities', () => {
    const catalog = new BlockCatalog();
    const text = catalog.create('text', 'text', 'page');
    expect(catalog.canEditText(text)).toBe(true);
    expect(catalog.acceptsChildren(text, [catalog.create('image', 'image', 'page')])).toBe(false);
    expect(catalog.acceptsChildren({ id: 'body', type: 'element', tag: 'body' }, [text])).toBe(
      true,
    );
    expect(
      catalog.canEditText({
        id: 'unknown',
        type: 'element',
        tag: 'div',
        children: [{ id: 'table', type: 'element', tag: 'table', children: [] }],
      }),
    ).toBe(false);
    expect(
      catalog.recognize({
        id: 'mjml-text',
        type: 'element',
        tag: 'div',
        children: [{ id: 'inline', type: 'text', value: 'Text' }],
      })?.type,
    ).toBe('text');
  });

  it('permits paragraphs and lists only in rich text containers without unknown descendants', () => {
    const catalog = new BlockCatalog();
    const list = [
      {
        id: 'list',
        type: 'element' as const,
        tag: 'ul',
        children: [
          {
            id: 'li',
            type: 'element' as const,
            tag: 'li',
            children: [{ id: 'value', type: 'text' as const, value: 'Item' }],
          },
        ],
      },
    ];
    const root = {
      id: 'td',
      type: 'element' as const,
      tag: 'td',
      attrs: { style: 'color:red' },
      children: [{ id: 'text', type: 'text' as const, value: 'Text' }],
    };
    expect(catalog.canEditRichText(root)).toBe(true);
    expect(catalog.acceptsRichText(root, list)).toBe(true);
    expect(catalog.acceptsRichText(catalog.create('text', 'p', 'email'), list)).toBe(false);
    expect(
      catalog.acceptsRichText(root, [
        { id: 'image', type: 'element', tag: 'img', attrs: { src: 'https://example.com/image' } },
      ]),
    ).toBe(false);
    expect(
      catalog.canEditRichText({
        ...root,
        children: [
          {
            id: 'unknown',
            type: 'element',
            tag: 'span',
            attrs: { 'data-custom': 'keep' },
            children: [],
          },
        ],
      }),
    ).toBe(true);
  });

  it('preserves native table and list content models when moving blocks', () => {
    const catalog = new BlockCatalog();
    const cell = { id: 'cell', type: 'element' as const, tag: 'td' };
    const section = catalog.create('section', 'section', 'page');
    expect(catalog.acceptsChildren(section, [cell])).toBe(false);
    expect(catalog.acceptsRootChildren([cell])).toBe(false);
    expect(catalog.acceptsChildren({ id: 'row', type: 'element', tag: 'tr' }, [cell])).toBe(true);
    expect(
      catalog.acceptsChildren({ id: 'row', type: 'element', tag: 'tr' }, [
        catalog.create('text', 'text', 'page'),
      ]),
    ).toBe(false);
    expect(catalog.acceptsRootChildren([{ id: 'list-item', type: 'element', tag: 'li' }])).toBe(
      false,
    );
    expect(
      catalog.acceptsChildren({ id: 'list', type: 'element', tag: 'ul' }, [
        { id: 'list-item', type: 'element', tag: 'li' },
      ]),
    ).toBe(true);
  });
});
