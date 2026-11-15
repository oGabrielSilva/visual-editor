import { describe, expect, it } from 'vitest';
import { EditorFactory } from '../../../src/composition/factory';
import type { StorePort } from '../../../src/application/host';
import type { DocumentNode } from '../../../src/core/document';
import { CssDocumentCodec } from '../../../src/codecs/css';

const compiler = {
  async compile() {
    throw new Error('Not used by this fixture');
  },
};
const factory = new EditorFactory(() => compiler);
function find(nodes: readonly DocumentNode[], tag: string): DocumentNode {
  for (const node of nodes) {
    if (node.tag === tag) return node;
    const nested = node.children?.length ? findOptional(node.children, tag) : undefined;
    if (nested) return nested;
  }
  throw new Error('Missing fixture node');
}
function findOptional(nodes: readonly DocumentNode[], tag: string): DocumentNode | undefined {
  for (const node of nodes) {
    if (node.tag === tag) return node;
    const nested = findOptional(node.children ?? [], tag);
    if (nested) return nested;
  }
  return undefined;
}

describe('transactional editor commands', () => {
  it('changes readonly at runtime without resetting a pending draft or history', async () => {
    const { session } = factory.create({ source: { html: '<p>Original</p>', css: '' } });
    const id = find(session.snapshot().nodes, 'p').id;
    expect(session.updateText(id, 'Accepted')).toBe(true);
    session.setMode('html');
    session.setDraftSource({ html: '<p>Pending</p>', css: '' });
    const before = session.getState();
    session.setReadOnly(true);
    expect(session.getState()).toMatchObject({
      readOnly: true,
      dirty: true,
      canUndo: true,
      draftSource: before.draftSource,
      document: before.document,
    });
    expect(session.commitDraft()).toBe(false);
    expect(session.undo()).toBe(false);
    expect(await session.save()).toBe(false);
    session.setReadOnly(false);
    expect(session.commitDraft()).toBe(true);
    expect(session.exportSource().html).toContain('Pending');
    expect(session.undo()).toBe(true);
    expect(session.exportSource().html).toContain('Accepted');
    session.dispose();
    expect(() => session.setReadOnly(false)).toThrow('SESSION_DISPOSED');
  });
  it('preserves invalid source, the valid document and history atomically', () => {
    const { session } = factory.create({ source: { html: '<p>Original</p>', css: '' } });
    session.setMode('html');
    // A source is only refused over the limits now (a script no longer refuses a page).
    const invalid = `${'<div>'.repeat(300)}Changed${'</div>'.repeat(300)}`;
    session.setDraftSource({ html: invalid, css: '' });
    const previous = session.snapshot();
    expect(session.commitDraft()).toBe(false);
    expect(session.getState().diagnostics.map((item) => item.code)).toEqual(['DOCUMENT_TOO_DEEP']);
    expect(session.setMode('visual')).toBe(false);
    expect(session.snapshot()).toEqual(previous);
    expect(session.getState().draftSource.html).toBe(invalid);
    expect(session.getState().dirty).toBe(true);
    expect(session.getState().canUndo).toBe(false);
  });

  it('commits a page source with a script and tells the author it was kept', () => {
    const { session } = factory.create({ source: { html: '<p>Original</p>', css: '' } });
    session.setMode('html');
    session.setDraftSource({ html: '<script>track()</script><p>Changed</p>', css: '' });
    expect(session.commitDraft()).toBe(true);
    expect(session.exportSource().html).toBe('<script>track()</script><p>Changed</p>');
    expect(session.getState().diagnostics).toEqual([
      expect.objectContaining({ code: 'SCRIPT_PRESERVED', severity: 'info', count: 1 }),
    ]);
    expect(session.setMode('visual')).toBe(true);
    // The notice describes the document, so it is still there after an unrelated edit.
    expect(session.updateText(find(session.snapshot().nodes, 'p').id, 'Edited')).toBe(true);
    expect(session.exportSource().html).toBe('<script>track()</script><p>Edited</p>');
    expect(session.getState().diagnostics.map((item) => item.code)).toEqual(['SCRIPT_PRESERVED']);
  });

  it('unwraps rich text paragraphs and leaves adjacent native HTML intact', () => {
    const { session } = factory.create({
      source: {
        html: '<section><h2>Title</h2><table><tbody><tr><td>Native</td></tr></tbody></table></section>',
        css: '',
      },
    });
    expect(
      session.updateRichText(
        find(session.snapshot().nodes, 'h2').id,
        '<p>New <strong>title</strong></p>',
      ),
    ).toBe(true);
    expect(session.exportSource().html).toContain('<h2>New <strong>title</strong></h2>');
    expect(session.exportSource().html).toContain(
      '<table><tbody><tr><td>Native</td></tr></tbody></table>',
    );
  });

  it('makes readonly a headless invariant and refuses malicious visual changes', () => {
    const editor = factory.create({ readOnly: true, source: { html: '<p>Original</p>', css: '' } });
    const id = find(editor.session.snapshot().nodes, 'p').id;
    expect(editor.session.updateText(id, 'Bad')).toBe(false);
    expect(editor.session.importSource({ html: '<p>Bad</p>', css: '' })).toBe(false);
    expect(editor.session.addBlock('text')).toBe(false);
    expect(editor.session.undo()).toBe(false);
    editor.session.setDraftSource({ html: '<p>Bad</p>', css: '' });
    expect(editor.session.getState().dirty).toBe(false);
    const writable = factory.create({
      source: { html: '<a href="https://example.com">Link</a>', css: '' },
    });
    expect(
      writable.session.updateAttribute(
        find(writable.session.snapshot().nodes, 'a').id,
        'href',
        'javascript:steal()',
      ),
    ).toBe(false);
    expect(writable.session.exportSource().html).toContain('https://example.com');
  });

  it('keeps accepted mutations independent of a failed presentation observer', () => {
    const { session } = factory.create();
    session.subscribe(() => {
      throw new Error('UI subscriber failed');
    });
    const id = find(session.snapshot().nodes, 'p').id;
    expect(session.updateText(id, 'Accepted')).toBe(true);
    expect(session.exportSource().html).toContain('Accepted');
  });

  it('does not run overlapping saves, and cancels its host on dispose', async () => {
    let complete: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    const store: StorePort = {
      async save(_document, _source, _revision, abort) {
        signal = abort;
        await new Promise<void>((resolve) => {
          complete = resolve;
        });
        return { revision: 1 };
      },
    };
    const editor = factory.create({ host: { store } });
    const first = editor.session.save();
    expect(await editor.session.save()).toBe(false);
    editor.dispose();
    expect(signal?.aborted).toBe(true);
    complete?.();
    expect(await first).toBe(false);
    expect(() => editor.session.snapshot()).toThrow('SESSION_DISPOSED');
  });

  it('preserves the inserted email block head styles', () => {
    const { session } = factory.create({
      kind: 'email',
      source: {
        html: '<!doctype html><html><head></head><body><p>Original</p></body></html>',
        css: '',
      },
    });
    expect(
      session.insertSource({
        html: '<html><head><style>@media(max-width:500px){.new{width:100%}}</style></head><body><div class="new">New block</div></body></html>',
        css: '',
      }),
    ).toBe(true);
    expect(new CssDocumentCodec().inspect(session.exportSource().css).declarations.width).toBe(
      '100%',
    );
    expect(session.exportSource().html).toContain('New block');
  });
});
