import { describe, expect, it } from 'vitest';
import { BlockEditorSession } from '../../../src/application/block-session';
import type { BlockStorePort } from '../../../src/application/block-session';
import { BlockPlacementService } from '../../../src/application/block-placement';
import { BlockInspector } from '../../../src/blocks/block-inspector';
import { BlockOutputRenderer } from '../../../src/blocks/block-output';
import { BlockPageGenerator } from '../../../src/blocks/page-generator';
import { BlockEmailRenderer } from '../../../src/blocks/email-renderer';
import { BlockMjmlGenerator } from '../../../src/blocks/email-generator';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { ContentPolicy } from '../../../src/security/policy';
import { HtmlDocumentAssembler } from '../../../src/renderers/preview-document';
import { SelectionPreviewRenderer } from '../../../src/renderers/selection-preview';
import type { BlockDocument } from '../../../src/core/block-document';
import { column, documentOf, registry, section, sequence, simple } from './support';

const pages = new BlockPageGenerator(registry);
const unusedCompiler = { compileGenerated: () => Promise.reject(new Error('unused')) };
const output = new BlockOutputRenderer(
  registry,
  pages,
  new BlockEmailRenderer(new BlockMjmlGenerator(registry), unusedCompiler),
);

function session(document: BlockDocument, store?: BlockStorePort): BlockEditorSession {
  const ids = sequence('id');
  return new BlockEditorSession(
    {
      factory: registry,
      output: { render: (piece) => output.render(piece) },
      identifiers: { next: ids },
      ...(store ? { store } : {}),
    },
    { document },
  );
}

const page = (): BlockDocument =>
  simple(
    [
      { id: 't1', type: 'text', props: { text: '<p>Um</p>' } },
      { id: 'i1', type: 'image', props: {} },
      { id: 'b1', type: 'button', props: { text: 'Ir' } },
    ],
    'page',
  );

describe('block editing session', () => {
  it('makes each command one step of history and moves forward in revision on undo', () => {
    const editor = session(page());
    expect(editor.updateProps('b1', { background: '#aa0000' })).toBe(true);
    expect(editor.getState().document.revision).toBe(1);
    expect(editor.getState().canUndo).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.document().find('b1')?.props.background).toBeUndefined();
    expect(editor.getState().document.revision).toBe(2);
    expect(editor.redo()).toBe(true);
    expect(editor.document().find('b1')?.props.background).toBe('#aa0000');
    expect(editor.getState().document.revision).toBe(3);
  });

  it('refuses an invalid command without changing anything', () => {
    const editor = session(page());
    expect(editor.updateProps('b1', { background: 'red;x:y' })).toBe(false);
    expect(editor.getState().document.revision).toBe(0);
    expect(editor.getState().diagnostics[0]?.severity).toBe('error');
  });

  it('replaces an image (address, description, asset) in one step', () => {
    const editor = session(page());
    expect(
      editor.replaceImage('i1', { url: 'https://example.test/a.png', alt: 'A', assetId: 'x1' }),
    ).toBe(true);
    expect(editor.document().find('i1')?.props).toEqual({
      url: 'https://example.test/a.png',
      alt: 'A',
      assetId: 'x1',
    });
    // Without an asset the previous one goes, still in one step.
    expect(editor.replaceImage('i1', { url: 'https://example.test/b.png' })).toBe(true);
    expect(editor.document().find('i1')?.props.assetId).toBeUndefined();
    editor.undo();
    expect(editor.document().find('i1')?.props.url).toBe('https://example.test/a.png');
    expect(editor.replaceImage('i1', { url: 'javascript:alert(1)' })).toBe(false);
  });

  it('drops the asset of an image whose address is typed by hand, in the same step', () => {
    const editor = session(page());
    editor.replaceImage('i1', { url: 'https://example.test/a.png', alt: 'A', assetId: 'x1' });
    expect(editor.updateProps('i1', { url: 'https://example.test/typed.png' })).toBe(true);
    expect(editor.document().find('i1')?.props).toEqual({
      url: 'https://example.test/typed.png',
      alt: 'A',
    });
    editor.undo();
    expect(editor.document().find('i1')?.props.assetId).toBe('x1');
    // Restoring the address to its default takes the asset too.
    expect(editor.restoreDefault('i1', ['url'])).toBe(true);
    expect(editor.document().find('i1')?.props.assetId).toBeUndefined();
  });

  it('drops the description of the previous image when the new choice brings none', () => {
    const editor = session(page());
    editor.replaceImage('i1', { url: 'https://example.test/a.png', alt: 'Antiga', assetId: 'x1' });
    expect(editor.replaceImage('i1', { url: 'https://example.test/b.png', assetId: 'x2' })).toBe(
      true,
    );
    expect(editor.document().find('i1')?.props).toEqual({
      url: 'https://example.test/b.png',
      assetId: 'x2',
    });
  });

  it('keeps a refused text open as typed, with the diagnostic, instead of losing it', () => {
    const editor = session(page());
    // Nested beyond what a text of a block accepts: the projection refuses it.
    const refused = `<p>${'<b>'.repeat(300)}texto digitado${'</b>'.repeat(300)}</p>`;
    expect(editor.beginText('t1')).toBe(true);
    expect(editor.updateTextDraft(refused)).toBe(true);
    expect(editor.commitText()).toBe(false);
    expect(editor.getState().pendingText).toEqual({ id: 't1', key: 'text' });
    expect(editor.getState().diagnostics[0]?.severity).toBe('error');
    expect(editor.getState().dirty).toBe(true);
    // Selecting another block, or any other command, is refused while the draft stands.
    expect(editor.select('b1')).toBe(false);
    expect(editor.getState().pendingText?.id).toBe('t1');
    // The person fixes the text: it is confirmed.
    expect(editor.updateTextDraft('<p>texto digitado</p>')).toBe(true);
    expect(editor.commitText()).toBe(true);
    expect(editor.document().find('t1')?.props.text).toBe('<p>texto digitado</p>');
    expect(editor.getState().pendingText).toBeUndefined();
  });

  it('returns the exact piece the store received, without changes made during the save', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stored: number[] = [];
    const editor = session(page(), {
      save: async (document) => {
        stored.push(document.revision);
        await gate;
        return { revision: document.revision };
      },
    });
    editor.updateProps('b1', { background: '#aa0000' });
    const saving = editor.saveDocument();
    await Promise.resolve();
    await Promise.resolve();
    expect(editor.updateProps('b1', { background: '#00aa00' })).toBe(true);
    release();
    const saved = await saving;
    expect(saved?.revision).toBe(stored[0]);
    expect(saved?.blocks[0]?.children?.[0]?.children?.[2]?.props.background).toBe('#aa0000');
    expect(editor.getState().dirty).toBe(true);
  });

  it('commits a text edited in place through updateText, normalized for its type', () => {
    const editor = session(page());
    expect(editor.beginText('t1')).toBe(true);
    expect(editor.getState().pendingText).toEqual({ id: 't1', key: 'text' });
    expect(editor.updateTextDraft('<p>Dois</p>')).toBe(true);
    expect(editor.getState().dirty).toBe(true);
    expect(editor.commitText()).toBe(true);
    expect(editor.document().find('t1')?.props.text).toBe('<p>Dois</p>');
    expect(editor.getState().pendingText).toBeUndefined();
    // A button takes one line without links.
    expect(editor.beginText('b1')).toBe(true);
    editor.updateTextDraft('<p>Linha <a href="https://example.test">um</a></p>');
    expect(editor.commitText()).toBe(true);
    expect(editor.document().find('b1')?.props.text).toBe('Linha um');
    expect(editor.beginText('i1')).toBe(false);
  });

  it('saves the piece with its final output and the expected revision', async () => {
    const calls: { revision: number; expected: number; html: string }[] = [];
    const editor = session(page(), {
      save: async (document, result, expected) => {
        calls.push({ revision: document.revision, expected, html: result.html });
        return { revision: document.revision };
      },
    });
    editor.updateProps('b1', { background: '#aa0000' });
    expect(editor.getState().dirty).toBe(true);
    expect(await editor.save()).toBe(true);
    expect(editor.getState().dirty).toBe(false);
    expect(calls[0]?.expected).toBe(0);
    expect(calls[0]?.html).toContain('ve-button');
    expect(calls[0]?.html).not.toContain('data-visual-editor');
    editor.updateProps('b1', { background: '#00aa00' });
    await editor.save();
    expect(calls[1]?.expected).toBe(1);
  });

  it('selects the new block and keeps the global styles in the history', () => {
    const editor = session(page());
    const id = editor.insert('divider', { position: 'after', id: 'b1' });
    expect(id).toBeDefined();
    expect(editor.getState().selectedBlockId).toBe(id);
    expect(editor.updateStyles({ button: { background: '#112233' } })).toBe(true);
    expect(editor.restoreStyleDefault('button', ['background'])).toBe(true);
    editor.undo();
    expect(editor.document().styles.button?.background).toBe('#112233');
    expect(editor.remove('b1')).toBe(true);
    expect(editor.select('b1')).toBe(false);
  });
});

describe('placement of blocks', () => {
  const placement = new BlockPlacementService(registry);
  const two = documentOf(
    [
      section('s1', [column('c1', [{ id: 'a', type: 'text', props: {} }])]),
      section('s2', [column('c2', [{ id: 'b', type: 'text', props: {} }])]),
    ],
    'page',
  );

  it('offers content blocks the columns and their siblings, never inside themselves', () => {
    const targets = placement.movementTargets(two, 'a');
    expect(targets.find((entry) => entry.targetId === 'b')?.placements).toEqual([
      'before',
      'after',
    ]);
    expect(targets.find((entry) => entry.targetId === 'c2')?.placements).toEqual(['inside']);
    expect(targets.some((entry) => entry.targetId === 's1')).toBe(false);
    // The only column of a section never leaves it.
    expect(placement.movementTargets(two, 'c1')).toEqual([]);
    expect(placement.insertionTargets(two, 'section').map((entry) => entry.targetId)).toEqual([
      's1',
      's2',
    ]);
  });

  it('steps past a sibling, or into the neighbouring container', () => {
    const columns = documentOf(
      [
        section('s1', [
          column('c1', [{ id: 'a', type: 'text', props: {} }]),
          column('c2', [{ id: 'b', type: 'text', props: {} }]),
        ]),
      ],
      'page',
    );
    expect(placement.step(columns, 'a', 'down')).toEqual({
      position: 'inside',
      parentId: 'c2',
      index: 0,
    });
    expect(placement.step(columns, 'b', 'up')).toEqual({
      position: 'inside',
      parentId: 'c1',
      index: 1,
    });
    expect(placement.step(two, 's1', 'down')).toEqual({ position: 'after', id: 's2' });
    expect(placement.step(two, 's1', 'up')).toBeUndefined();
  });
});

describe('panels generated from the definitions', () => {
  const inspector = new BlockInspector(registry);

  it('shows the own, inherited and default values of a field', () => {
    const document = documentOf(
      [section('s1', [column('c1', [{ id: 'b1', type: 'button', props: { text: 'x' } }])])],
      'email',
      { styles: { button: { background: '#123456' } } },
    ).snapshot();
    const background = inspector.fields(document, 'b1').find((field) => field.key === 'background');
    expect(background?.own).toBeUndefined();
    expect(background?.inherits).toBe('button.background');
    expect(background?.effective).toBe('#123456');
    const styles = inspector.styles(document);
    const button = styles.find((group) => group.group === 'button');
    expect(button?.keys.find((key) => key.key === 'background')).toMatchObject({
      value: '#123456',
      overridden: true,
    });
    // Internal fields are not shown.
    expect(inspector.fields(document, 'c1').some((field) => field.key === 'weight')).toBe(false);
  });
});

describe('preview of a block piece in the editing frame', () => {
  const codec = new HtmlDocumentCodec(new ContentPolicy());
  const renderer = new SelectionPreviewRenderer(
    codec,
    new ContentPolicy(),
    new HtmlDocumentAssembler(codec, new ContentPolicy()),
  );

  it('keeps the marks of the generator, once per block of the piece', async () => {
    const input = await output.preview(page());
    const preview = renderer.blocks.build(input, 'Selecionar');
    expect(preview.nodeIds).toEqual(['s1', 'c1', 't1', 'i1', 'b1']);
    expect(preview.html.match(/data-visual-editor-node="t1"/g)).toHaveLength(1);
    expect(preview.html).toContain('data-visual-editor-edit-node="t1"');
    expect(preview.regions.find((region) => region.id === 'i1')?.media).toBe('image');
    expect(preview.regions.find((region) => region.id === 'b1')?.links).toBe(false);
  });

  it('tells the frame of a block piece that the host opens no block menu', async () => {
    const input = await output.preview(page());
    expect(renderer.blocks.build(input, 'Selecionar', { menu: false }).html).toContain(
      '"menu":false',
    );
    expect(renderer.blocks.build(input, 'Selecionar').html).not.toContain('"menu":false');
  });

  it('drops marks that name no block, repeat a block or sit outside their block', async () => {
    const input = await output.preview(page());
    const forged = {
      ...input,
      source: {
        ...input.source,
        html: input.source.html
          .replace('</main>', '<p data-visual-editor-node="t1">copia</p></main>')
          .replace(
            '</main>',
            '<p data-visual-editor-node="forjado" data-visual-editor-selected="true">x</p><span data-visual-editor-edit-node="b1">y</span></main>',
          ),
      },
    };
    const preview = renderer.blocks.build(forged, 'Selecionar');
    expect(preview.html.match(/data-visual-editor-node="t1"/g)).toHaveLength(1);
    expect(preview.html).not.toContain('forjado');
    expect(preview.html).not.toMatch(/<p[^>]*data-visual-editor-selected/);
    expect(preview.html.match(/data-visual-editor-edit-node="b1"/g)).toHaveLength(1);
  });
});
