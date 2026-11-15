import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NodeMjmlCompiler } from '../../../src/compilation/node-compiler';
import { EditorFactory } from '../../../src/composition/factory';
import type { EditorInstance } from '../../../src/composition/factory';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { CanvasLayout } from '../../../src/core/canvas-layout';
import { EditorDocument } from '../../../src/core/document';
import type { DocumentNode, EditorDocumentData } from '../../../src/core/document';
import { ContentPolicy } from '../../../src/security/policy';

let compiler: NodeMjmlCompiler;
let factory: EditorFactory;
const editors: EditorInstance[] = [];

beforeAll(() => {
  compiler = new NodeMjmlCompiler(new URL('../../../dist/server-worker.js', import.meta.url));
  factory = new EditorFactory(() => compiler);
});
afterAll(() => {
  for (const editor of editors) editor.session.dispose();
  compiler.dispose();
});

const all = (nodes: readonly DocumentNode[]): DocumentNode[] =>
  nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
const classes = (node: DocumentNode): readonly string[] =>
  (node.attrs?.class ?? '').split(' ').filter(Boolean);
const hasClass = (node: DocumentNode, name: string): boolean => classes(node).includes(name);
const text = (node: DocumentNode): string =>
  node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(text).join('');
const parentOf = (document: EditorDocumentData, id: string): DocumentNode | undefined =>
  all(document.nodes).find((node) => node.children?.some((child) => child.id === id));
const ancestors = (document: EditorDocumentData, id: string): DocumentNode[] => {
  const chain: DocumentNode[] = [];
  let parent = parentOf(document, id);
  while (parent) {
    chain.push(parent);
    parent = parentOf(document, parent.id);
  }
  return chain;
};
const conditionals = (nodes: readonly DocumentNode[]): string[] =>
  all(nodes)
    .filter((node) => node.type === 'comment' && node.value?.startsWith('[if mso | IE]>'))
    .map((node) => node.value ?? '')
    // An Outlook divider opens and closes its own table inside one comment: not layout.
    .filter((value) => !(value.startsWith('[if mso | IE]><table') && value.includes('</table>')));
const wrappers = (document: EditorDocumentData): DocumentNode[] =>
  all(document.nodes).filter((node) => node.attrs?.role === 'article');
const preheaders = (document: EditorDocumentData): DocumentNode[] =>
  all(document.nodes).filter(
    (node) => node.tag === 'div' && (node.attrs?.style ?? '').startsWith('display:none'),
  );
const ghostTables = (values: readonly string[]): { opened: number; closed: number } => ({
  opened: values.reduce((sum, value) => sum + value.split('<table').length - 1, 0),
  closed: values.reduce((sum, value) => sum + value.split('</table>').length - 1, 0),
});

async function welcome(): Promise<EditorInstance> {
  const editor = factory.create({ kind: 'email' });
  editors.push(editor);
  expect(await editor.controller.applyTemplate('email-welcome')).toBe(true);
  // Models no longer carry a sample preheader: the author's own is set here,
  // so these cases keep proving that insertions neither multiply nor import one.
  expect(editor.session.updatePreheader('Uma mensagem para sua próxima conversa.')).toBe(true);
  return editor;
}

/** The first content row of the second (two column) section of the welcome template. */
function columnRow(document: EditorDocumentData): { row: DocumentNode; column: DocumentNode } {
  const column = all(document.nodes).filter((node) => hasClass(node, 'mj-column-per-50'))[0];
  const row = column && all([column]).find((node) => node.tag === 'tr');
  if (!column || !row) throw new Error('Missing fixture column');
  return { row, column };
}

const reimports = (editor: EditorInstance): void => {
  const source = editor.session.exportSource();
  const result = new HtmlDocumentCodec().import(source, 'email');
  expect(result.diagnostics).toEqual([]);
};

describe('inserting a generated e-mail block', () => {
  it('adds only the content row when the destination is a column', async () => {
    const editor = await welcome();
    const before = editor.session.snapshot();
    const { row, column } = columnRow(before);
    const title = all([row]).find((node) => node.type === 'text' && !!node.value?.trim());
    if (!title) throw new Error('Missing fixture text');
    expect(editor.controller.select(title.id)).toBe(true);
    expect(await editor.controller.addBlock('button')).toBe(true);
    const after = editor.session.snapshot();

    expect(wrappers(after)).toHaveLength(1);
    expect(preheaders(after)).toHaveLength(preheaders(before).length);
    expect(conditionals(after.nodes)).toEqual(conditionals(before.nodes));
    expect(all(after.nodes).filter((node) => hasClass(node, 'editor-layout-section'))).toHaveLength(
      all(before.nodes).filter((node) => hasClass(node, 'editor-layout-section')).length,
    );

    const updated = all(after.nodes).find((node) => node.id === column.id);
    const body = updated && all([updated]).find((node) => node.tag === 'tbody');
    const rows = (body?.children ?? []).filter((node) => node.type === 'element');
    expect(rows.map((node) => node.tag)).toEqual(['tr', 'tr', 'tr']);
    expect(rows[0]?.id).toBe(row.id);
    const inserted = rows[1];
    if (!inserted) throw new Error('Missing inserted row');
    expect(text(inserted).trim()).toBe('Saiba mais');
    const cell = inserted.children?.find((node) => node.type === 'element');
    expect(cell?.tag).toBe('td');
    expect(cell?.attrs?.style).toContain('padding:10px 25px');
    expect(all([inserted]).some((node) => node.tag === 'a' && !!node.attrs?.href)).toBe(true);
    expect(all([inserted]).some((node) => node.type === 'comment')).toBe(false);
    expect(all([inserted]).some((node) => node.attrs?.role === 'article')).toBe(false);
    expect(all([inserted]).some((node) => hasClass(node, 'editor-layout-section'))).toBe(false);
    reimports(editor);
  }, 35_000);

  it('never multiplies preheaders, wrappers or ghost tables across many insertions', async () => {
    const editor = await welcome();
    const before = editor.session.snapshot();
    const anchor = all([columnRow(before).row]).find(
      (node) => node.type === 'text' && !!node.value?.trim(),
    );
    if (!anchor) throw new Error('Missing fixture text');
    for (const type of ['button', 'text', 'heading', 'image', 'divider', 'spacer']) {
      expect(editor.controller.select(anchor.id), type).toBe(true);
      expect(await editor.controller.addBlock(type), type).toBe(true);
    }
    const after = editor.session.snapshot();
    expect(wrappers(after)).toHaveLength(1);
    expect(preheaders(after)).toHaveLength(1);
    expect(conditionals(after.nodes)).toEqual(conditionals(before.nodes));
    const html = editor.session.exportSource().html;
    expect(html.split('Uma mensagem para sua próxima conversa.')).toHaveLength(2);
    expect(html.split('role="article"')).toHaveLength(2);
    expect(html.split('<title>')).toHaveLength(2);
    reimports(editor);
  }, 60_000);

  it('adds a whole section with its balanced Outlook pair at section level', async () => {
    const editor = await welcome();
    const before = editor.session.snapshot();
    const sections = all(before.nodes).filter((node) => hasClass(node, 'editor-layout-section'));
    const first = sections[0];
    if (!first) throw new Error('Missing fixture section');
    expect(await editor.controller.addBlock('text', first.id, 'after')).toBe(true);
    const after = editor.session.snapshot();
    const wrapper = wrappers(after)[0];
    expect(wrappers(after)).toHaveLength(1);
    expect(preheaders(after)).toHaveLength(1);
    const sequence = (wrapper?.children ?? [])
      .filter((node) => node.type !== 'text' || !!node.value?.trim())
      .map((node) =>
        node.type === 'comment'
          ? node.value?.includes('</td></tr></table><table')
            ? 'bridge'
            : node.value?.includes('<table')
              ? 'open'
              : 'close'
          : 'section',
      );
    // The new unit sits after the closing comment of the first section, never inside its pair.
    expect(sequence.slice(0, 6)).toEqual(['open', 'section', 'close', 'open', 'section', 'close']);
    const added = (wrapper?.children ?? []).filter((node) => node.type === 'element')[1];
    expect(added && text(added).trim()).toBe('Escreva uma mensagem para sua próxima conversa.');
    const ghosts = ghostTables(conditionals(after.nodes));
    expect(ghosts.opened).toBe(ghosts.closed);
    expect(ghosts.opened).toBe(ghostTables(conditionals(before.nodes)).opened + 2);
    reimports(editor);
  }, 35_000);

  it('moves a section block out of the column it was requested from', async () => {
    const editor = await welcome();
    const before = editor.session.snapshot();
    const { row, column } = columnRow(before);
    const anchor = all([row]).find((node) => node.type === 'text' && !!node.value?.trim());
    if (!anchor) throw new Error('Missing fixture text');
    expect(editor.controller.select(anchor.id)).toBe(true);
    expect(await editor.controller.addBlock('columns')).toBe(true);
    const after = editor.session.snapshot();
    const updated = all(after.nodes).find((node) => node.id === column.id);
    expect(updated && all([updated]).filter((node) => node.tag === 'tr')).toHaveLength(
      all([column]).filter((node) => node.tag === 'tr').length,
    );
    const wrapper = wrappers(after)[0];
    const sections = (wrapper?.children ?? []).filter((node) => node.type === 'element');
    expect(sections).toHaveLength(4);
    expect(sections[2] && text(sections[2])).toContain('Primeira coluna');
    expect(sections[1]?.id).toBe(
      ancestors(before, column.id).find((node) => hasClass(node, 'editor-layout-section'))?.id,
    );
    const ghosts = ghostTables(conditionals(after.nodes));
    expect(ghosts.opened).toBe(ghosts.closed);
    reimports(editor);
  }, 35_000);

  it('appends to the article instead of the body when nothing is selected', async () => {
    const editor = await welcome();
    const block = await editor.templates.createBlock('text', 'email');
    expect(block.insertion).toBe('content');
    expect(block.html).not.toContain('display:none');
    expect((await editor.templates.createBlock('footer', 'email')).insertion).toBe('section');
    expect(editor.session.insertSource(block)).toBe(true);
    const after = editor.session.snapshot();
    const body = all(after.nodes).find((node) => node.tag === 'body');
    expect(
      (body?.children ?? []).filter((node) => node.type === 'element').map((node) => node.tag),
    ).toEqual(['div', 'div']);
    expect(wrappers(after)).toHaveLength(1);
    const sections = (wrappers(after)[0]?.children ?? []).filter((node) => node.type === 'element');
    expect(sections).toHaveLength(4);
    expect(sections[3] && text(sections[3]).trim()).toBe(
      'Escreva uma mensagem para sua próxima conversa.',
    );
    reimports(editor);
  }, 35_000);

  it('strips the preheader and wrapper even from a full compiled message used as a block', async () => {
    const editor = await welcome();
    const message = await editor.emailRenderer.createSource(
      '<mjml><mj-head><mj-title>Outra</mj-title><mj-preview>Outro preheader</mj-preview></mj-head><mj-body><mj-section css-class="editor-layout-section"><mj-column css-class="editor-layout-column"><mj-text>Primeira</mj-text></mj-column></mj-section><mj-section css-class="editor-layout-section"><mj-column css-class="editor-layout-column"><mj-text>Segunda</mj-text></mj-column></mj-section></mj-body></mjml>',
    );
    expect(message.html).toContain('Outro preheader');
    const { row } = columnRow(editor.session.snapshot());
    const body = parentOf(editor.session.snapshot(), row.id);
    if (!body) throw new Error('Missing fixture body');
    // Two sections cannot become rows of one column: they follow the enclosing section.
    expect(editor.session.insertSource(message, body.id, 1)).toBe(true);
    const after = editor.session.snapshot();
    expect(wrappers(after)).toHaveLength(1);
    expect(preheaders(after)).toHaveLength(1);
    expect(editor.session.exportSource().html).not.toContain('Outro preheader');
    const ghosts = ghostTables(conditionals(after.nodes));
    expect(ghosts.opened).toBe(ghosts.closed);
    reimports(editor);
  }, 35_000);

  it('sends content aimed at the section cell to the last column of that section', async () => {
    const editor = await welcome();
    const before = editor.session.snapshot();
    const column = columnRow(before).column;
    const sectionCell = parentOf(before, column.id);
    if (!sectionCell) throw new Error('Missing fixture cell');
    const columns = (sectionCell.children ?? []).filter((node) => node.type === 'element');
    const last = columns.at(-1);
    expect(columns.length).toBeGreaterThan(1);
    if (!last) throw new Error('Missing fixture column');
    const rowsOf = (document: EditorDocumentData, id: string): DocumentNode[] => {
      const node = all(document.nodes).find((candidate) => candidate.id === id);
      const body = node && all([node]).find((candidate) => candidate.tag === 'tbody');
      return (body?.children ?? []).filter((candidate) => candidate.type === 'element');
    };
    const block = await editor.templates.createBlock('button', 'email');
    const index = (sectionCell.children ?? []).findIndex((node) => node.id === column.id) + 1;
    expect(editor.session.insertSource(block, sectionCell.id, index)).toBe(true);
    const shellRow = parentOf(before, sectionCell.id);
    if (!shellRow) throw new Error('Missing fixture shell row');
    expect(editor.session.insertSource(block, shellRow.id)).toBe(true);
    expect(
      editor.session.attachAsset(
        { id: 'asset_8', url: 'https://cdn.example.com/a.png', alt: 'Foto' },
        undefined,
        sectionCell.id,
      ),
    ).toBe(true);
    const after = editor.session.snapshot();
    // The cell keeps exactly its columns and Outlook comments; the shell keeps its single row.
    const cellAfter = all(after.nodes).find((node) => node.id === sectionCell.id);
    expect((cellAfter?.children ?? []).map((node) => node.id)).toEqual(
      (sectionCell.children ?? []).map((node) => node.id),
    );
    const rowAfter = all(after.nodes).find((node) => node.id === shellRow.id);
    expect((rowAfter?.children ?? []).map((node) => node.id)).toEqual(
      (shellRow.children ?? []).map((node) => node.id),
    );
    expect(
      parentOf(after, shellRow.id)?.children?.filter((node) => node.tag === 'tr'),
    ).toHaveLength(1);
    expect(rowsOf(after, column.id)).toHaveLength(rowsOf(before, column.id).length);
    const added = rowsOf(after, last.id).slice(rowsOf(before, last.id).length);
    expect(added.map((node) => node.tag)).toEqual(['tr', 'tr', 'tr']);
    expect(added.slice(0, 2).map((node) => text(node).trim())).toEqual([
      'Saiba mais',
      'Saiba mais',
    ]);
    expect(
      all(added.slice(2)).some((node) => node.attrs?.['data-host-asset-id'] === 'asset_8'),
    ).toBe(true);
    expect(conditionals(after.nodes)).toEqual(conditionals(before.nodes));
    reimports(editor);
  }, 35_000);

  it('keeps refusing flow content between Outlook cells when no column is recognized', async () => {
    const editor = factory.create({
      kind: 'email',
      source: {
        html: '<!doctype html><html><head></head><body><table role="presentation"><tbody><tr><td><!--[if mso | IE]><table role="presentation"><tr><td><![endif]--><p>Sem coluna</p><!--[if mso | IE]></td></tr></table><![endif]--></td></tr></tbody></table></body></html>',
        css: '',
      },
    });
    editors.push(editor);
    const before = editor.session.snapshot();
    const cell = all(before.nodes).find((node) => node.tag === 'td');
    if (!cell) throw new Error('Missing fixture cell');
    const block = await editor.templates.createBlock('button', 'email');
    expect(editor.session.insertSource(block, cell.id, 1)).toBe(false);
    expect(editor.session.getState().diagnostics.map((item) => item.code)).toEqual([
      'CHANGE_INVALID',
    ]);
    expect(
      editor.session.attachAsset(
        { id: 'asset_9', url: 'https://cdn.example.com/a.png', alt: 'Foto' },
        undefined,
        cell.id,
      ),
    ).toBe(false);
    expect(editor.session.snapshot()).toEqual(before);
  }, 35_000);

  it('adds a new row after the selected row of a column instead of a sibling cell', async () => {
    const editor = await welcome();
    const before = editor.session.snapshot();
    const { row, column } = columnRow(before);
    const body = parentOf(before, row.id);
    if (!body) throw new Error('Missing fixture body');
    const block = await editor.templates.createBlock('button', 'email');
    // The index is relative to the cells of the row; the row itself must not grow.
    expect(editor.session.insertSource(block, row.id, 1)).toBe(true);
    expect(
      editor.session.attachAsset(
        { id: 'asset_3', url: 'https://cdn.example.com/a.png', alt: 'Foto' },
        undefined,
        row.id,
      ),
    ).toBe(true);
    const after = editor.session.snapshot();
    const rowAfter = all(after.nodes).find((node) => node.id === row.id);
    expect((rowAfter?.children ?? []).map((node) => node.id)).toEqual(
      (row.children ?? []).map((node) => node.id),
    );
    const rows = (all(after.nodes).find((node) => node.id === body.id)?.children ?? []).filter(
      (node) => node.type === 'element',
    );
    const originals = (body.children ?? []).filter((node) => node.type === 'element');
    expect(rows).toHaveLength(originals.length + 2);
    expect(rows[0]?.id).toBe(row.id);
    // Both were requested after the same row: the image, inserted last, comes first.
    expect(all(rows[1] ? [rows[1]] : []).some((node) => node.tag === 'img')).toBe(true);
    expect(rows[2] && text(rows[2]).trim()).toBe('Saiba mais');
    for (const added of rows.slice(1, 3))
      expect(
        (added.children ?? []).filter((node) => node.type === 'element').map((node) => node.tag),
      ).toEqual(['td']);
    expect(all(after.nodes).filter((node) => node.id === column.id)).toHaveLength(1);
    expect(conditionals(after.nodes)).toEqual(conditionals(before.nodes));
    reimports(editor);
  }, 35_000);

  it('places a section block after a wrapper which cannot hold it, from any table part', async () => {
    const html =
      '<html><body><center><table><tbody><tr><td>Oi</td></tr></tbody></table></center></body></html>';
    for (const type of ['section', 'columns', 'footer']) {
      const probe = factory.create({ kind: 'email', source: { html, css: '' } });
      editors.push(probe);
      const block = await probe.templates.createBlock(type, 'email');
      expect(block.insertion, type).toBe('section');
      for (const tag of ['table', 'tbody', 'tr', 'td']) {
        const editor = factory.create({ kind: 'email', source: { html, css: '' } });
        editors.push(editor);
        const before = editor.session.snapshot();
        const target = all(before.nodes).find((node) => node.tag === tag);
        const center = all(before.nodes).find((node) => node.tag === 'center');
        if (!target || !center) throw new Error('Missing fixture');
        expect(editor.session.insertSource(block, target.id), `${type} at ${tag}`).toBe(true);
        const after = editor.session.snapshot();
        // The hand-written layout is untouched and the section follows it inside the body.
        expect(all(after.nodes).find((node) => node.id === center.id)).toEqual(center);
        const body = all(after.nodes).find((node) => node.tag === 'body');
        const elements = (body?.children ?? []).filter((node) => node.type === 'element');
        expect(elements[0]?.id, `${type} at ${tag}`).toBe(center.id);
        expect(elements.length, `${type} at ${tag}`).toBeGreaterThan(1);
        expect(elements.slice(1).every((node) => node.tag === 'div')).toBe(true);
        const ghosts = ghostTables(conditionals(after.nodes));
        expect(ghosts.opened).toBe(ghosts.closed);
        reimports(editor);
      }
    }
  }, 90_000);

  it('inserts rows into a hand-written table layout without any section shell', async () => {
    const editor = factory.create({
      kind: 'email',
      source: {
        html: '<!doctype html><html><head></head><body><table role="presentation" width="100%"><tbody><tr><td><p>Linha existente</p></td></tr></tbody></table></body></html>',
        css: '',
      },
    });
    editors.push(editor);
    const before = editor.session.snapshot();
    const body = all(before.nodes).find((node) => node.tag === 'tbody');
    const cell = all(before.nodes).find((node) => node.tag === 'td');
    if (!body || !cell) throw new Error('Missing fixture table');
    const block = await editor.templates.createBlock('button', 'email');
    expect(editor.session.insertSource(block, body.id, 1)).toBe(true);
    expect(editor.session.insertSource(block, cell.id)).toBe(true);
    const after = editor.session.snapshot();
    expect(conditionals(after.nodes)).toEqual([]);
    expect(wrappers(after)).toHaveLength(0);
    expect(preheaders(after)).toHaveLength(0);
    const rows = (all(after.nodes).find((node) => node.id === body.id)?.children ?? []).filter(
      (node) => node.type === 'element',
    );
    expect(rows.map((node) => node.tag)).toEqual(['tr', 'tr']);
    const nested = (all(after.nodes).find((node) => node.id === cell.id)?.children ?? []).filter(
      (node) => node.type === 'element',
    );
    expect(nested.map((node) => node.tag)).toEqual(['p', 'table']);
    expect(nested[1]?.attrs?.role).toBe('presentation');
    reimports(editor);
  }, 35_000);

  it('keeps the generic rules for a plain snippet', () => {
    const editor = factory.create({
      kind: 'email',
      source: { html: '<!doctype html><html><head></head><body><p>Um</p></body></html>', css: '' },
    });
    editors.push(editor);
    expect(editor.session.insertSource({ html: '<div class="novo">Novo</div>', css: '' })).toBe(
      true,
    );
    expect(editor.session.exportSource().html).toContain(
      '<p>Um</p><div class="novo">Novo</div></body>',
    );
  });
});

describe('a new library image in e-mail and page', () => {
  const asset = { id: 'asset_1', url: 'https://cdn.example.com/a.png', alt: 'Foto' };
  const layout = new CanvasLayout();

  it('is born inside a content row of the selected column', async () => {
    const editor = await welcome();
    const before = editor.session.snapshot();
    const { row, column } = columnRow(before);
    const anchor = all([row]).find((node) => node.type === 'text' && !!node.value?.trim());
    if (!anchor) throw new Error('Missing fixture text');
    expect(editor.controller.select(anchor.id)).toBe(true);
    expect(editor.controller.attachAsset(asset)).toBe(true);
    const after = editor.session.snapshot();
    const image = all(after.nodes).find((node) => node.attrs?.['data-host-asset-id'] === 'asset_1');
    if (!image) throw new Error('Missing image');
    expect(image.attrs).toEqual({
      src: asset.url,
      alt: 'Foto',
      style: 'display:block;max-width:100%;height:auto;border:0',
      'data-host-asset-id': 'asset_1',
    });
    expect(image.attrs?.width).toBeUndefined();
    const chain = ancestors(after, image.id);
    expect(chain.slice(0, 3).map((node) => node.tag)).toEqual(['td', 'tr', 'tbody']);
    expect(chain.some((node) => node.id === column.id)).toBe(true);
    expect(chain[0]?.attrs).toEqual({ align: 'center', style: 'padding:10px 25px' });
    expect(conditionals(after.nodes)).toEqual(conditionals(before.nodes));
    expect(layout.resolve(after, image.id)?.kind).toBe('image');
    reimports(editor);
  }, 35_000);

  it('joins the last column of the message when nothing is selected', async () => {
    const editor = await welcome();
    expect(editor.session.attachAsset(asset)).toBe(true);
    const after = editor.session.snapshot();
    const image = all(after.nodes).find((node) => node.attrs?.['data-host-asset-id'] === 'asset_1');
    if (!image) throw new Error('Missing image');
    const chain = ancestors(after, image.id);
    expect(chain.slice(0, 3).map((node) => node.tag)).toEqual(['td', 'tr', 'tbody']);
    expect(chain.some((node) => hasClass(node, 'editor-layout-column'))).toBe(true);
    expect(wrappers(after)).toHaveLength(1);
    reimports(editor);
  }, 35_000);

  it('uses a full width presentation table when the message has no column', () => {
    const editor = factory.create({
      kind: 'email',
      source: { html: '<!doctype html><html><head></head><body><p>Um</p></body></html>', css: '' },
    });
    editors.push(editor);
    expect(editor.session.attachAsset(asset)).toBe(true);
    expect(editor.session.exportSource().html).toContain(
      '<p>Um</p><table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"><tbody><tr><td align="center" style="padding:10px 25px"><img src="https://cdn.example.com/a.png" alt="Foto" style="display:block;max-width:100%;height:auto;border:0" data-host-asset-id="asset_1"></td></tr></tbody></table></body>',
    );
  });

  it('is fluid and free of e-mail markup in a page', () => {
    const editor = factory.create({
      kind: 'page',
      source: { html: '<main><p>Um</p></main>', css: '' },
    });
    editors.push(editor);
    const main = editor.session.snapshot().nodes[0];
    if (!main) throw new Error('Missing fixture');
    expect(editor.session.attachAsset(asset, undefined, main.id)).toBe(true);
    expect(editor.session.exportSource().html).toBe(
      '<main><p>Um</p><img src="https://cdn.example.com/a.png" alt="Foto" style="max-width:100%;height:auto" data-host-asset-id="asset_1"></main>',
    );
  });

  it('keeps replacing only the source of an existing image', () => {
    const editor = factory.create({
      kind: 'email',
      source: { html: '<p><img src="https://x.test/a.png" alt="a" width="120"></p>', css: '' },
    });
    editors.push(editor);
    const image = all(editor.session.snapshot().nodes).find((node) => node.tag === 'img');
    if (!image) throw new Error('Missing fixture');
    expect(editor.session.attachAsset(asset, image.id)).toBe(true);
    expect(editor.session.exportSource().html).toBe(
      '<p><img src="https://cdn.example.com/a.png" alt="Foto" width="120" data-host-asset-id="asset_1"></p>',
    );
  });
});

describe('conditional comments of compiled catalog templates', () => {
  it('survive a round trip, also when the JSON is reopened without its source', async () => {
    const templates = factory.create({ kind: 'email' });
    editors.push(templates);
    const codec = new HtmlDocumentCodec();
    for (const id of ['email-welcome', 'email-announcement']) {
      const source = await templates.templates.create(id);
      expect(source.html, id).toContain('<!--[if mso | IE]>');
      expect(source.html, id).toContain('<![endif]-->');
      const imported = codec.import({ html: source.html, css: source.css }, 'email');
      expect(imported.diagnostics, id).toEqual([]);
      if (!imported.document) throw new Error('Rejected template');
      expect(codec.export(imported.document).html, id).toBe(source.html);
      const portable: unknown = JSON.parse(JSON.stringify(imported.document));
      const reopened = EditorDocument.from(portable).snapshot();
      expect(new ContentPolicy().validate(reopened), id).toEqual([]);
      const exported = codec.export(reopened);
      const again = codec.import(exported, 'email');
      expect(again.diagnostics, id).toEqual([]);
      if (!again.document) throw new Error('Rejected reopened template');
      const comments = (nodes: readonly DocumentNode[]): string[] =>
        all(nodes)
          .filter((node) => node.type === 'comment')
          .map((node) => node.value ?? '');
      expect(comments(again.document.nodes), id).toEqual(comments(imported.document.nodes));
      expect(comments(again.document.nodes).length, id).toBeGreaterThan(0);
      expect(exported.html.split('<!--[if').length, id).toBe(source.html.split('<!--[if').length);
      expect(exported.html.split('<![endif]-->').length, id).toBe(
        source.html.split('<![endif]-->').length,
      );
      expect(exported.html, id).not.toContain('<![if');
      expect(exported.html, id).not.toContain('<![endif]>');
    }
  }, 60_000);
});
