import { describe, expect, it } from 'vitest';
import {
  BLOCK_DOCUMENT_LIMITS,
  BlockDocument,
  BlockDocumentError,
} from '../../../src/core/block-document';
import type { Block } from '../../../src/core/block-document';
import { DocumentValidationError } from '../../../src/core/document';
import { SECTION_LAYOUT_LIMITS } from '../../../src/core/section-layout';
import { column, data, documentOf, registry, section, sequence, simple } from './support';

const text = (id: string, value = '<p>Olá</p>', props = {}): Block => ({
  id,
  type: 'text',
  props: { text: value, ...props },
});

function code(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof BlockDocumentError) return error.code;
    throw error;
  }
  return undefined;
}

describe('block document: schema and structural rules', () => {
  it('accepts a valid piece and keeps it immutable', () => {
    const document = simple([text('t1')]);
    expect(document.revision).toBe(0);
    expect(Object.isFrozen(document.blocks)).toBe(true);
    expect(Object.isFrozen(document.blocks[0]?.children?.[0]?.props)).toBe(true);
    const copy = document.snapshot();
    (copy.blocks as Block[]).length = 0;
    expect(document.blocks).toHaveLength(1);
    expect(BlockDocumentError.prototype).toBeInstanceOf(DocumentValidationError);
  });

  it('refuses the wrong schema version, unknown keys and malformed fields', () => {
    expect(code(() => BlockDocument.from({ ...data([]), schemaVersion: 1 }, registry))).toBe(
      'INVALID_BLOCK_DOCUMENT_SCHEMA',
    );
    expect(code(() => BlockDocument.from({ ...data([]), preheader: 'x' }, registry))).toBe(
      'INVALID_BLOCK_DOCUMENT_SCHEMA',
    );
    expect(code(() => BlockDocument.from({ ...data([]), meta: { lang: 'pt BR' } }, registry))).toBe(
      'INVALID_BLOCK_DOCUMENT_SCHEMA',
    );
    expect(code(() => BlockDocument.from('x', registry))).toBe('INVALID_BLOCK_DOCUMENT_SCHEMA');
    expect(code(() => BlockDocument.from(new Date(), registry))).toBe(
      'INVALID_BLOCK_DOCUMENT_SCHEMA',
    );
  });

  it('only accepts ids that are safe in class names and unique', () => {
    expect(code(() => simple([text('a b')]))).toBe('INVALID_BLOCK_DOCUMENT_SCHEMA');
    expect(code(() => simple([text('x"y')]))).toBe('INVALID_BLOCK_DOCUMENT_SCHEMA');
    expect(code(() => simple([text('c1')]))).toBe('DUPLICATE_BLOCK_ID');
    expect(code(() => simple([text('t1'), text('t1')]))).toBe('DUPLICATE_BLOCK_ID');
  });

  it('keeps sections at the root and columns inside sections only', () => {
    expect(code(() => documentOf([text('t1')]))).toBe('BLOCK_NOT_ALLOWED_AT_ROOT');
    expect(code(() => documentOf([column('c1', [])]))).toBe('BLOCK_NOT_ALLOWED_AT_ROOT');
    expect(code(() => simple([column('c2', [])]))).toBe('BLOCK_CHILD_NOT_ALLOWED');
    expect(code(() => documentOf([section('s1', [text('t1')])]))).toBe('BLOCK_CHILD_NOT_ALLOWED');
    expect(code(() => documentOf([section('s1', [])]))).toBe('TOO_FEW_CHILDREN');
    expect(code(() => simple([{ id: 't1', type: 'text', props: {}, children: [] }]))).toBe(
      'BLOCK_CHILD_NOT_ALLOWED',
    );
  });

  it('limits a section to the columns of the layout limits', () => {
    const columns = (count: number) =>
      Array.from({ length: count }, (_, index) => column(`c${index}`, []));
    expect(documentOf([section('s1', columns(SECTION_LAYOUT_LIMITS.columns))]).blocks).toHaveLength(
      1,
    );
    expect(
      code(() => documentOf([section('s1', columns(SECTION_LAYOUT_LIMITS.columns + 1))])),
    ).toBe('TOO_MANY_CHILDREN');
  });

  it('accepts a form only in a page', () => {
    const form: Block = { id: 'f1', type: 'form', props: { reference: 'lead-form' } };
    expect(simple([form], 'page').find('f1')?.type).toBe('form');
    expect(code(() => simple([form], 'email'))).toBe('BLOCK_KIND_NOT_ALLOWED');
  });

  it('validates every property against its definition', () => {
    expect(code(() => simple([text('t1', '<p>x</p>', { colour: '#fff' })]))).toBe(
      'UNKNOWN_BLOCK_PROP',
    );
    expect(code(() => simple([text('t1', '<p>x</p>', { color: 'red;x:y' })]))).toBe(
      'INVALID_BLOCK_PROPS',
    );
    expect(code(() => simple([text('t1', '<p>x</p>', { fontSize: '16em' })]))).toBe(
      'INVALID_BLOCK_PROPS',
    );
    expect(code(() => simple([text('t1', '<p>x</p>', { align: 'middle' })]))).toBe(
      'INVALID_BLOCK_PROPS',
    );
    expect(code(() => simple([text('t1', '<p>x</p>', { padding: '1px 2px 3px 4px 5px' })]))).toBe(
      'INVALID_BLOCK_PROPS',
    );
    expect(code(() => documentOf([section('s1', [column('c1', [], { weight: 13 })])]))).toBe(
      'INVALID_BLOCK_PROPS',
    );
    expect(code(() => simple([{ id: 'b1', type: 'button', props: { fullWidth: 'yes' } }]))).toBe(
      'INVALID_BLOCK_PROPS',
    );
  });

  it('validates global styles against the catalog of styles', () => {
    expect(
      documentOf([], 'email', { styles: { button: { background: '#ff0000' } } }).styles,
    ).toEqual({ button: { background: '#ff0000' } });
    expect(code(() => documentOf([], 'email', { styles: { button: { shadow: '1px' } } }))).toBe(
      'UNKNOWN_GLOBAL_STYLE',
    );
    expect(
      code(() => documentOf([], 'email', { styles: { button: { background: 'url(x)' } } })),
    ).toBe('INVALID_GLOBAL_STYLES');
    // A page-only style is not part of an e-mail.
    expect(code(() => documentOf([], 'email', { styles: { section: { columnGap: '8px' } } }))).toBe(
      'UNKNOWN_GLOBAL_STYLE',
    );
    expect(documentOf([], 'page', { styles: { section: { columnGap: '8px' } } }).styles).toEqual({
      section: { columnGap: '8px' },
    });
  });

  it('bounds depth, size and number of blocks before walking them', () => {
    let deep: unknown = { id: 'x', type: 'column', props: {} };
    for (let index = 0; index < 1_200; index++)
      deep = { id: `d${index}`, type: 'section', props: {}, children: [deep] };
    expect(code(() => BlockDocument.from(data([deep as Block]), registry))).toBe(
      'DOCUMENT_TOO_DEEP',
    );
    const many = Array.from({ length: BLOCK_DOCUMENT_LIMITS.blocks }, (_, index) =>
      text(`t${index}`),
    );
    expect(
      code(() =>
        documentOf([
          section('s1', [column('c1', many.slice(0, 200)), column('c2', many.slice(200, 400))]),
        ]),
      ),
    ).toBeUndefined();
    const sections = Array.from({ length: 1_700 }, (_, index) =>
      section(`s${index}`, [column(`c${index}`, [text(`t${index}`)])]),
    );
    expect(code(() => documentOf(sections))).toBe('BLOCK_DOCUMENT_TOO_MANY_BLOCKS');
  });
});

describe('block document: operations', () => {
  const base = () =>
    documentOf([
      section('s1', [column('c1', [text('t1'), text('t2')]), column('c2', [text('t3')])]),
      section('s2', [column('c3', [])]),
    ]);

  it('inserts before, after and inside, incrementing the revision', () => {
    const block = text('n1');
    const before = base().insert(block, { position: 'before', id: 't2' });
    expect(before.revision).toBe(1);
    expect(before.find('c1')?.children?.map((child) => child.id)).toEqual(['t1', 'n1', 't2']);
    const after = base().insert(block, { position: 'after', id: 't2' });
    expect(after.find('c1')?.children?.map((child) => child.id)).toEqual(['t1', 't2', 'n1']);
    const inside = base().insert(block, { position: 'inside', parentId: 'c3' });
    expect(inside.find('c3')?.children?.map((child) => child.id)).toEqual(['n1']);
    const atIndex = base().insert(block, { position: 'inside', parentId: 'c1', index: 0 });
    expect(atIndex.find('c1')?.children?.[0]?.id).toBe('n1');
    const root = base().insert(section('s9', [column('c9', [])]), { position: 'inside', index: 0 });
    expect(root.blocks[0]?.id).toBe('s9');
  });

  it('validates what it inserts', () => {
    expect(code(() => base().insert(text('n1'), { position: 'inside' }))).toBe(
      'BLOCK_NOT_ALLOWED_AT_ROOT',
    );
    expect(code(() => base().insert(text('t1'), { position: 'after', id: 't2' }))).toBe(
      'DUPLICATE_BLOCK_ID',
    );
    expect(code(() => base().insert(text('n1'), { position: 'after', id: 'missing' }))).toBe(
      'BLOCK_NOT_FOUND',
    );
    expect(
      code(() => base().insert(text('n1'), { position: 'inside', parentId: 'c1', index: 9 })),
    ).toBe('INVALID_BLOCK_TARGET');
    expect(code(() => base().insert(column('c8', []), { position: 'after', id: 't1' }))).toBe(
      'BLOCK_CHILD_NOT_ALLOWED',
    );
  });

  it('moves a block between columns and refuses to move it into itself', () => {
    const moved = base().move('t1', { position: 'inside', parentId: 'c3' });
    expect(moved.find('c1')?.children?.map((child) => child.id)).toEqual(['t2']);
    expect(moved.find('c3')?.children?.map((child) => child.id)).toEqual(['t1']);
    expect(moved.parentOf('t1')).toBe('c3');
    const reordered = base().move('s2', { position: 'before', id: 's1' });
    expect(reordered.blocks.map((block) => block.id)).toEqual(['s2', 's1']);
    expect(code(() => base().move('s1', { position: 'inside', parentId: 'c1' }))).toBe(
      'INVALID_BLOCK_TARGET',
    );
    expect(code(() => base().move('c1', { position: 'after', id: 'c1' }))).toBe(
      'INVALID_BLOCK_TARGET',
    );
    expect(code(() => base().move('t1', { position: 'inside' }))).toBe('BLOCK_NOT_ALLOWED_AT_ROOT');
  });

  it('duplicates a subtree with new ids right after the original', () => {
    const duplicated = base().duplicate('s1', sequence('copy'));
    expect(duplicated.blocks.map((block) => block.id)).toEqual(['s1', 'copy1', 's2']);
    const copy = duplicated.find('copy1');
    expect(copy?.children?.map((child) => child.id)).toEqual(['copy2', 'copy5']);
    expect(copy?.children?.[0]?.children?.map((child) => child.id)).toEqual(['copy3', 'copy4']);
    expect(copy?.children?.[0]?.children?.[0]?.props).toEqual(duplicated.find('t1')?.props);
    expect(code(() => base().duplicate('t1', () => 't2'))).toBe('DUPLICATE_BLOCK_ID');
  });

  it('removes a block and keeps the section rules', () => {
    expect(base().remove('t1').find('t1')).toBeUndefined();
    expect(base().remove('s2').blocks).toHaveLength(1);
    expect(code(() => base().remove('c3'))).toBe('TOO_FEW_CHILDREN');
    expect(code(() => base().remove('nope'))).toBe('BLOCK_NOT_FOUND');
  });

  it('duplicates a column until the column limit', () => {
    let document = base();
    document = document.duplicate('c1', sequence('a'));
    document = document.duplicate('c1', sequence('b'));
    expect(document.find('s1')?.children).toHaveLength(4);
    expect(code(() => document.duplicate('c1', sequence('c')))).toBe('TOO_MANY_CHILDREN');
  });

  it('updates and restores properties; absent values inherit again', () => {
    const updated = base().updateProps('t1', { color: ' #112233 ', align: 'center' });
    expect(updated.find('t1')?.props).toMatchObject({ color: '#112233', align: 'center' });
    const restored = updated.restoreDefault('t1', ['color']);
    expect(restored.find('t1')?.props).toEqual({ text: '<p>Olá</p>', align: 'center' });
    expect(restored.revision).toBe(2);
    expect(code(() => base().updateProps('t1', { color: 'expression(x)' }))).toBe(
      'INVALID_BLOCK_PROPS',
    );
    expect(code(() => base().updateProps('t1', { href: 'https://x.y' }))).toBe(
      'UNKNOWN_BLOCK_PROP',
    );
  });

  it('updates the text through the projection of the block mode', () => {
    const updated = base().updateText(
      't1',
      'text',
      '<p onclick="x()">Oi <b>você</b></p><script>x()</script>',
    );
    expect(updated.find('t1')?.props.text).toBe('<p>Oi <b>você</b></p>');
    expect(code(() => base().updateText('c1', 'text', 'x'))).toBe('BLOCK_TEXT_NOT_EDITABLE');
    expect(code(() => base().updateText('t1', 'color', 'x'))).toBe('BLOCK_TEXT_NOT_EDITABLE');
  });

  it('updates and restores global styles against the catalog defaults', () => {
    const styled = base().updateStyles({ button: { background: '#ff0000', radius: '0px' } });
    expect(styled.styles).toEqual({ button: { background: '#ff0000', radius: '0px' } });
    expect(styled.restoreStyleDefault('button', ['radius']).styles).toEqual({
      button: { background: '#ff0000' },
    });
    expect(styled.restoreStyleDefault('button', ['radius', 'background']).styles).toEqual({});
    expect(styled.restoreStyleDefault('button').styles).toEqual({});
    expect(
      styled.updateStyles({ body: { textColor: '#000' } }).restoreStyleDefault().styles,
    ).toEqual({});
    expect(code(() => base().updateStyles({ button: { background: 'red}' } }))).toBe(
      'INVALID_GLOBAL_STYLES',
    );
    expect(code(() => base().updateStyles({ unknown: { x: '1' } }))).toBe('UNKNOWN_GLOBAL_STYLE');
  });

  it('changes language and internal title only', () => {
    const changed = base().withMeta({ lang: 'en-US' }).withTitle('Interna');
    expect(changed.meta.lang).toBe('en-US');
    expect(changed.title).toBe('Interna');
    expect(code(() => base().withMeta({ lang: '<x>' }))).toBe('INVALID_BLOCK_DOCUMENT_SCHEMA');
  });

  it('never mutates the original document', () => {
    const original = base();
    const before = JSON.stringify(original.snapshot());
    original.updateProps('t1', { color: '#000000' });
    original.remove('t1');
    original.move('t1', { position: 'inside', parentId: 'c3' });
    original.updateStyles({ button: { background: '#000000' } });
    expect(JSON.stringify(original.snapshot())).toBe(before);
  });

  it('creates new blocks from the definitions', () => {
    const next = sequence('k');
    const created = registry.create('section', next);
    expect(created.children).toHaveLength(1);
    const document = base().insert(created, { position: 'after', id: 's2' });
    expect(document.blocks.map((block) => block.id)).toEqual(['s1', 's2', 'k1']);
  });
});

describe('aggregate limits, no-ops and move', () => {
  const base = () =>
    documentOf([section('s1', [column('c1', [text('t1'), text('t2'), text('t3')])])]);

  it('refuses an e-mail whose MJML would pass the compilation limit', () => {
    const big = (id: string): Block => ({
      id,
      type: 'html',
      props: { html: `<p>${'a'.repeat(110_000)}</p>` },
    });
    expect(simple([big('r1')]).find('r1')).toBeDefined();
    expect(code(() => simple([big('r1'), big('r2')]))).toBe('BLOCK_EMAIL_TOO_LARGE');
  });

  it('refuses a page whose output would pass the source limit of a conversion', () => {
    const big = (id: string): Block => ({
      id,
      type: 'html',
      props: { html: `<p>${'a'.repeat(450_000)}</p>` },
    });
    expect(simple([big('r1'), big('r2'), big('r3'), big('r4')], 'page').revision).toBe(0);
    expect(
      code(() => simple([big('r1'), big('r2'), big('r3'), big('r4'), big('r5')], 'page')),
    ).toBe('BLOCK_PAGE_TOO_LARGE');
  });

  it('returns the same document when an operation changes nothing', () => {
    const document = base().updateProps('t1', { color: '#112233' });
    expect(document.revision).toBe(1);
    expect(document.updateProps('t1', {})).toBe(document);
    expect(document.updateProps('t1', { color: ' #112233 ' })).toBe(document);
    expect(document.restoreDefault('t1', ['align'])).toBe(document);
    expect(document.restoreDefault('t1', [])).toBe(document);
    expect(document.restoreStyleDefault()).toBe(document);
    expect(document.restoreStyleDefault('button')).toBe(document);
    expect(document.updateStyles({})).toBe(document);
    expect(document.withMeta({ lang: 'pt-BR' })).toBe(document);
    expect(document.withTitle('')).toBe(document);
    const styled = document.updateStyles({ button: { radius: '0px' } });
    expect(styled.updateStyles({ button: { radius: '0px' } })).toBe(styled);
    expect(styled.restoreStyleDefault('button', ['color'])).toBe(styled);
  });

  it('counts the index of a move inside the same parent before the block leaves it', () => {
    const order = (document: ReturnType<typeof base>) =>
      document.find('c1')?.children?.map((child) => child.id);
    expect(order(base().move('t1', { position: 'inside', parentId: 'c1', index: 2 }))).toEqual([
      't2',
      't1',
      't3',
    ]);
    expect(order(base().move('t1', { position: 'inside', parentId: 'c1', index: 3 }))).toEqual([
      't2',
      't3',
      't1',
    ]);
    expect(order(base().move('t3', { position: 'inside', parentId: 'c1', index: 0 }))).toEqual([
      't3',
      't1',
      't2',
    ]);
    expect(order(base().move('t2', { position: 'inside', parentId: 'c1', index: 1 }))).toEqual([
      't1',
      't2',
      't3',
    ]);
    expect(code(() => base().move('t1', { position: 'inside', parentId: 'c1', index: 4 }))).toBe(
      'INVALID_BLOCK_TARGET',
    );
  });
});

describe('copy on write', () => {
  it('shares the untouched blocks with the next revision and leaves the previous one as it was', () => {
    const before = simple([
      { id: 't1', type: 'text', props: { text: '<p>Um</p>' } },
      { id: 't2', type: 'text', props: { text: '<p>Dois</p>' } },
    ]);
    const other = documentOf([
      section('s1', [column('c1', [{ id: 't1', type: 'text', props: { text: '<p>Um</p>' } }])]),
      section('s2', [column('c2', [{ id: 'x1', type: 'text', props: { text: '<p>X</p>' } }])]),
    ]);
    const after = before.updateProps('t1', { fontSize: '20px' });
    expect(after.find('t2')).toBe(before.find('t2'));
    expect(after.find('t1')).not.toBe(before.find('t1'));
    expect(before.find('t1')?.props.fontSize).toBeUndefined();
    expect(Object.isFrozen(after.find('t1'))).toBe(true);
    const moved = other.move('t1', { position: 'inside', parentId: 'c2', index: 0 });
    expect(moved.find('c2')?.children?.map((block) => block.id)).toEqual(['t1', 'x1']);
    expect(other.find('c1')?.children?.map((block) => block.id)).toEqual(['t1']);
    expect(moved.find('x1')).toBe(other.find('x1'));
    // A refused value is still refused on the shared path.
    expect(() => after.updateProps('t2', { fontSize: 'enorme' })).toThrow();
  });
});
