import { describe, expect, it } from 'vitest';
import { CanvasLayout } from '../../../src/core/canvas-layout';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { EditorFactory } from '../../../src/composition/factory';
import type { DocumentNode, EditorDocumentData } from '../../../src/core/document';

function document(html: string, kind: 'page' | 'email' = 'page'): EditorDocumentData {
  const imported = new HtmlDocumentCodec().import({ html, css: '' }, kind);
  if (!imported.document) throw new Error('INVALID_FIXTURE');
  return imported.document;
}
function find(
  nodes: readonly DocumentNode[],
  predicate: (node: DocumentNode) => boolean,
): DocumentNode {
  for (const node of nodes) {
    if (predicate(node)) return node;
    try {
      return find(node.children ?? [], predicate);
    } catch {
      /* Search the next subtree. */
    }
  }
  throw new Error('MISSING_FIXTURE_NODE');
}
const factory = new EditorFactory(() => ({
  compile: async () => {
    throw new Error('NOT_USED');
  },
}));

describe('logical canvas layout', () => {
  it('resolves nested marks and inline links to the owning text region', () => {
    const data = document(
      '<main><h2>First <strong><span class="safe">marked</span></strong> <a href="https://example.com">link</a></h2></main>',
    );
    const layout = new CanvasLayout();
    const heading = find(data.nodes, (node) => node.tag === 'h2');
    for (const tag of ['strong', 'span', 'a']) {
      expect(layout.resolve(data, find(data.nodes, (node) => node.tag === tag).id)?.id).toBe(
        heading.id,
      );
    }
    expect(layout.regions(data).map((region) => region.node.tag)).toEqual(['main', 'h2']);
  });

  it('retains actual sibling indices and adjusts a same-parent move exactly once', () => {
    const data = document('<main><p id="a">A</p> <p id="b">B</p> <p id="c">C</p></main>');
    const layout = new CanvasLayout();
    const a = find(data.nodes, (node) => node.attrs?.id === 'a');
    const b = find(data.nodes, (node) => node.attrs?.id === 'b');
    const c = find(data.nodes, (node) => node.attrs?.id === 'c');
    expect(layout.target(data, a.id, c.id, 'after')).toMatchObject({ index: 4 });
    expect(layout.target(data, c.id, a.id, 'before')).toMatchObject({ index: 0 });
    expect(layout.target(data, a.id, b.id, 'before')).toMatchObject({ index: 1 });
    expect(layout.insertionTarget(data, b.id)).toMatchObject({ index: 3 });
  });

  it('refuses cycles, text destinations, infrastructure and invalid structural parents', () => {
    const data = document(
      '<main><section id="outer"><section id="inner"><p>Text</p></section></section><table><tbody><tr><td>Cell</td></tr></tbody></table></main>',
    );
    const layout = new CanvasLayout();
    const outer = find(data.nodes, (node) => node.attrs?.id === 'outer');
    const inner = find(data.nodes, (node) => node.attrs?.id === 'inner');
    const p = find(data.nodes, (node) => node.tag === 'p');
    const cell = find(data.nodes, (node) => node.tag === 'td');
    expect(layout.target(data, outer.id, inner.id, 'inside')).toBeUndefined();
    expect(layout.target(data, outer.id, p.id, 'inside')).toBeUndefined();
    expect(layout.target(data, cell.id, inner.id, 'inside')).toBeUndefined();
    expect(layout.insertionTarget(data, 'missing')).toBeUndefined();
    expect(layout.acceptsInsertion(data, { parentId: inner.id, index: -1 }, [p])).toBe(false);
    expect(layout.acceptsInsertion(data, { parentId: 'missing', index: 0 }, [p])).toBe(false);
  });

  it('keeps compiled text and button rows as whole movable units', () => {
    const data = document(
      '<div><table role="presentation"><tbody><tr id="text-row"><td style="padding:16px"><div style="color:#123456">Hello <strong>world</strong></div></td></tr><tr id="button-row"><td style="padding:24px"><table role="presentation"><tbody><tr><td><a style="display:inline-block" href="https://example.com">Continue</a></td></tr></tbody></table></td></tr></tbody></table></div>',
      'email',
    );
    const layout = new CanvasLayout();
    const textRow = find(data.nodes, (node) => node.attrs?.id === 'text-row');
    const buttonRow = find(data.nodes, (node) => node.attrs?.id === 'button-row');
    const strong = find(data.nodes, (node) => node.tag === 'strong');
    const anchor = find(data.nodes, (node) => node.tag === 'a');
    expect(layout.resolve(data, strong.id)).toMatchObject({
      id: textRow.id,
      kind: 'text',
      editable: true,
    });
    expect(layout.resolve(data, anchor.id)).toMatchObject({
      id: buttonRow.id,
      kind: 'button',
      editable: true,
    });
    expect(layout.editableNode(data, buttonRow.id)?.id).toBe(anchor.id);
    expect(layout.target(data, textRow.id, buttonRow.id, 'after')).toMatchObject({ index: 1 });
  });

  it('exposes empty containers and preserves native regions without claiming text editing', () => {
    const data = document(
      '<main><section id="empty"></section><custom-card data-keep="yes">Native</custom-card></main>',
    );
    const layout = new CanvasLayout();
    const empty = find(data.nodes, (node) => node.attrs?.id === 'empty');
    const native = find(data.nodes, (node) => node.tag === 'custom-card');
    expect(layout.resolve(data, empty.id)).toMatchObject({ container: true, editable: false });
    expect(layout.insertionTarget(data, empty.id)).toEqual({ parentId: empty.id, index: 0 });
    expect(layout.resolve(data, native.id)).toMatchObject({ kind: 'native', editable: false });
    const regions = layout.regions(data);
    Object.assign(regions[0]?.node ?? {}, { tag: 'script' });
    expect(data.nodes[0]?.tag).toBe('main');
  });
});

describe('canvas commands keep one canonical document', () => {
  it('moves, duplicates and removes logical rows while retaining tables, attributes and native siblings', () => {
    const editor = factory.create({
      kind: 'email',
      source: {
        html: '<div><table data-keep="table"><tbody><tr id="a"><td style="padding:16px">A</td></tr><tr id="b"><td>B</td></tr></tbody></table><custom-card data-custom="keep">Native</custom-card></div>',
        css: '',
      },
    });
    try {
      const a = find(editor.session.snapshot().nodes, (node) => node.attrs?.id === 'a');
      const b = find(editor.session.snapshot().nodes, (node) => node.attrs?.id === 'b');
      expect(editor.controller.moveTo(a.id, b.id, 'after')).toBe(true);
      expect(editor.session.exportSource().html.indexOf('id="b"')).toBeLessThan(
        editor.session.exportSource().html.indexOf('id="a"'),
      );
      expect(editor.controller.applyCanvasAction(a.id, 'duplicate')).toBe(true);
      expect(editor.controller.applyCanvasAction(a.id, 'remove')).toBe(true);
      expect(editor.session.exportSource().html).toContain('data-keep="table"');
      expect(editor.session.exportSource().html).toContain('style="padding:16px"');
      expect(editor.session.exportSource().html).toContain(
        '<custom-card data-custom="keep">Native</custom-card>',
      );
      expect(editor.controller.undo()).toBe(true);
      expect(editor.controller.redo()).toBe(true);
    } finally {
      editor.dispose();
    }
  });

  it('moves a logical email block between column table bodies without moving the text alone', () => {
    const editor = factory.create({
      kind: 'email',
      source: {
        html: '<div><div id="left"><table role="presentation"><tbody><tr id="a"><td style="padding:16px"><div>A</div></td></tr></tbody></table></div><div id="right"><table role="presentation"><tbody><tr id="b"><td><div>B</div></td></tr></tbody></table></div></div>',
        css: '',
      },
    });
    try {
      const a = find(editor.session.snapshot().nodes, (node) => node.attrs?.id === 'a');
      const right = find(editor.session.snapshot().nodes, (node) => node.attrs?.id === 'right');
      expect(editor.controller.moveTo(a.id, right.id, 'inside')).toBe(true);
      const moved = find(editor.session.snapshot().nodes, (node) => node.attrs?.id === 'right');
      expect(
        find(moved.children ?? [], (node) => node.attrs?.id === 'a').children?.[0]?.attrs?.style,
      ).toBe('padding:16px');
    } finally {
      editor.dispose();
    }
  });

  it('inserts from the palette after selected text, inside a chosen section and never at an invalid destination', async () => {
    const editor = factory.create({
      source: {
        html: '<main><section id="section"><h1>Title</h1><p>Body</p></section></main>',
        css: '',
      },
    });
    try {
      const heading = find(editor.session.snapshot().nodes, (node) => node.tag === 'h1');
      const section = find(editor.session.snapshot().nodes, (node) => node.attrs?.id === 'section');
      expect(editor.controller.select(heading.id)).toBe(true);
      expect(await editor.controller.addBlock('heading')).toBe(true);
      const updated = find(editor.session.snapshot().nodes, (node) => node.attrs?.id === 'section');
      expect(updated.children?.map((node) => node.tag)).toEqual(['h1', 'h2', 'p']);
      expect(await editor.controller.addBlockAt('text', section.id, 'inside')).toBe(true);
      const before = editor.session.snapshot();
      expect(await editor.controller.addBlockAt('heading', heading.id, 'inside')).toBe(false);
      expect(await editor.controller.addBlockAt('heading', 'missing', 'before')).toBe(false);
      expect(editor.session.snapshot()).toEqual(before);
    } finally {
      editor.dispose();
    }
  });

  it('adapts generated email envelopes to a valid row when insertion targets a column table body', async () => {
    const editor = factory.create({
      kind: 'email',
      compiler: {
        compile: async () =>
          '<html><head><style>.generated{color:#123456}</style></head><body><div class="generated"><p>Generated block</p></div></body></html>',
      },
      source: {
        html: '<div><table role="presentation"><tbody><tr id="row"><td><div>Original</div></td></tr></tbody></table></div>',
        css: '',
      },
    });
    try {
      const row = find(editor.session.snapshot().nodes, (node) => node.attrs?.id === 'row');
      expect(editor.controller.select(row.id)).toBe(true);
      expect(await editor.controller.addBlock('text')).toBe(true);
      const body = find(editor.session.snapshot().nodes, (node) => node.tag === 'tbody');
      expect(
        body.children?.filter((node) => node.type === 'element').map((node) => node.tag),
      ).toEqual(['tr', 'tr']);
      expect(editor.session.exportSource().html).toContain('Generated block');
      expect(editor.session.exportSource().css).toContain('.generated');
    } finally {
      editor.dispose();
    }
  });

  it('places host assets and form slots in the selected context', () => {
    const editor = factory.create({
      source: { html: '<main><section><p>Selected</p><h2>Tail</h2></section></main>', css: '' },
    });
    try {
      const paragraph = find(editor.session.snapshot().nodes, (node) => node.tag === 'p');
      editor.controller.select(paragraph.id);
      expect(
        editor.controller.attachAsset({
          id: 'asset1',
          url: 'https://example.com/image.png',
          alt: 'Asset',
        }),
      ).toBe(true);
      expect(editor.controller.connectFormReference('form1')).toBe(true);
      const section = find(editor.session.snapshot().nodes, (node) => node.tag === 'section');
      expect(section.children?.map((node) => node.tag)).toEqual(['p', 'div', 'img', 'h2']);
      expect(section.children?.[1]?.attrs?.['data-host-reference']).toBe('form1');
      expect(section.children?.[2]?.attrs?.['data-host-asset-id']).toBe('asset1');
    } finally {
      editor.dispose();
    }
  });

  it('refuses readonly and out-of-bounds mutations before changing the document', async () => {
    const editor = factory.create({
      readOnly: true,
      source: { html: '<section><p>A</p><p>B</p></section>', css: '' },
    });
    try {
      const regions = editor.controller.canvasRegions().filter((region) => region.kind === 'text');
      const before = editor.session.snapshot();
      expect(editor.controller.moveTo(regions[0]!.id, regions[1]!.id, 'after')).toBe(false);
      expect(await editor.controller.addBlock('text')).toBe(false);
      expect(editor.controller.applyCanvasAction(regions[0]!.id, 'remove')).toBe(false);
      editor.session.setReadOnly(false);
      expect(
        editor.session.moveBlock(regions[0]!.id, regions[0]!.parentId ?? undefined, Number.NaN),
      ).toBe(false);
      expect(editor.session.snapshot()).toEqual(before);
    } finally {
      editor.dispose();
    }
  });
});
