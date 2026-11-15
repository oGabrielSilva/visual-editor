import { describe, expect, it } from 'vitest';
import { CanvasLayout } from '../../../src/core/canvas-layout';
import { BlockCatalog } from '../../../src/core/catalog';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { EditorFactory } from '../../../src/composition/factory';
import type { DocumentNode, EditorDocumentData } from '../../../src/core/document';

const source = {
  html: '<div><table role="presentation"><tbody><tr id="composed"><td style="padding:24px"><div><p id="eyebrow" style="color:#567">Opening</p><h2 id="title" style="font-size:32px;color:#123">Title <strong>marked</strong></h2><p id="body" style="color:#789">Body</p></div></td></tr><tr id="tail"><td><div>Tail</div></td></tr></tbody></table></div>',
  css: '.brand{color:teal}',
};
const factory = new EditorFactory(() => ({
  compile: async () => {
    throw new Error('NOT_USED');
  },
}));

function find(
  nodes: readonly DocumentNode[],
  predicate: (node: DocumentNode) => boolean,
): DocumentNode {
  const search = (children: readonly DocumentNode[]): DocumentNode | undefined => {
    for (const node of children) {
      if (predicate(node)) return node;
      const nested = search(node.children ?? []);
      if (nested) return nested;
    }
    return undefined;
  };
  const result = search(nodes);
  if (!result) throw new Error('MISSING_FIXTURE_NODE');
  return result;
}

function document(html = source.html): EditorDocumentData {
  const imported = new HtmlDocumentCodec().import({ html, css: source.css }, 'email');
  if (!imported.document) throw new Error('INVALID_FIXTURE');
  return imported.document;
}

describe('content selection and structural ownership', () => {
  it('selects composed email text independently while retaining its complete movement row', () => {
    const data = document();
    const layout = new CanvasLayout();
    const row = find(data.nodes, (node) => node.attrs?.id === 'composed');
    const entries = layout.selectionRegions(data);
    for (const name of ['eyebrow', 'title', 'body']) {
      const node = find(data.nodes, (candidate) => candidate.attrs?.id === name);
      expect(layout.resolveSelection(data, node.id)).toMatchObject({
        id: node.id,
        node,
        editable: true,
        container: false,
      });
      expect(layout.resolve(data, node.id)?.id).toBe(row.id);
      expect(entries.filter((entry) => entry.id === node.id)).toHaveLength(1);
    }
    const title = find(data.nodes, (node) => node.attrs?.id === 'title');
    const mark = find(data.nodes, (node) => node.tag === 'strong');
    expect(layout.resolveSelection(data, mark.id)?.id).toBe(title.id);
    expect(layout.resolveSelection(data, row.id)?.editable).toBe(false);
    expect(layout.regions(data).find((entry) => entry.id === row.id)?.editable).toBe(true);
  });

  it('only advertises inside destinations accepted by the structural projection', () => {
    const data = document();
    const layout = new CanvasLayout();
    const cell = find(data.nodes, (node) => node.tag === 'td');
    expect(layout.resolveSelection(data, cell.id)?.container).toBe(false);
    for (const region of layout.selectionRegions(data).filter((entry) => entry.container)) {
      expect(layout.insertionAt(data, region.id, 'inside')).toBeDefined();
    }
  });

  it('reaches images inside links and text wrappers without making their parent rich text', () => {
    const data = document(
      '<table role="presentation"><tbody><tr><td style="padding:12px"><p>Caption <a href="https://example.com"><img src="https://example.com/a.png" alt="Preview"></a></p></td></tr></tbody></table>',
    );
    const layout = new CanvasLayout();
    const image = find(data.nodes, (node) => node.tag === 'img');
    const paragraph = find(data.nodes, (node) => node.tag === 'p');
    expect(layout.resolveSelection(data, image.id)).toMatchObject({
      id: image.id,
      kind: 'image',
      editable: false,
      node: image,
    });
    expect(layout.resolveSelection(data, paragraph.id)?.editable).toBe(false);
  });

  it('keeps inline marks and links with their owning text block', () => {
    const data = document(
      '<h2>Title <strong><span class="brand">bold</span></strong> <a href="https://example.com">link</a></h2>',
    );
    const layout = new CanvasLayout();
    const heading = find(data.nodes, (node) => node.tag === 'h2');
    for (const tag of ['strong', 'span', 'a']) {
      const node = find(data.nodes, (candidate) => candidate.tag === tag);
      expect(layout.resolveSelection(data, node.id)?.id).toBe(heading.id);
    }
    expect(layout.selectionRegions(data).map((region) => region.id)).toEqual([heading.id]);
  });

  it('preserves mixed loose text and native regions without claiming isolated text editing', () => {
    const data = document(
      '<div>Loose text<h2>Title</h2><p>Body</p></div><custom-card>Native</custom-card>',
    );
    const layout = new CanvasLayout();
    const loose = find(data.nodes, (node) => node.type === 'text' && node.value === 'Loose text');
    const native = find(data.nodes, (node) => node.tag === 'custom-card');
    expect(layout.resolveSelection(data, loose.id)?.editable).toBe(false);
    expect(layout.resolveSelection(data, native.id)).toMatchObject({
      kind: 'native',
      editable: false,
    });
    const before = structuredClone(data);
    const projection = layout.selectionRegions(data);
    Object.assign(projection[0]?.node ?? {}, { tag: 'script' });
    expect(data).toEqual(before);
    expect(layout.resolveSelection(data, 'missing')).toBeUndefined();
  });
});

describe('rich-text content parent capabilities', () => {
  it('accepts existing rich blocks while rejecting unsupported children through the same catalog', () => {
    const catalog = new BlockCatalog();
    const data = document('<div><h2>Title</h2><p>Body</p></div>');
    const parent = find(data.nodes, (node) => node.tag === 'div');
    const heading = find(data.nodes, (node) => node.tag === 'h2');
    const paragraph = find(data.nodes, (node) => node.tag === 'p');
    expect(catalog.acceptsChildren(parent, [paragraph, heading])).toBe(true);
    for (const tag of ['img', 'script', 'table', 'tr']) {
      expect(
        catalog.acceptsChildren(parent, [{ id: `invalid-${tag}`, type: 'element', tag }]),
      ).toBe(false);
    }
    expect(
      catalog.acceptsChildren(parent, [
        {
          id: 'anchor',
          type: 'element',
          tag: 'a',
          children: [{ id: 'nested', type: 'element', tag: 'a' }],
        },
      ]),
    ).toBe(false);
    expect(
      catalog.acceptsChildren(parent, [
        { id: 'event', type: 'element', tag: 'p', attrs: { onclick: 'unsafe()' } },
      ]),
    ).toBe(false);
    const table = { id: 'table', type: 'element' as const, tag: 'table' };
    expect(catalog.acceptsChildren(table, [heading])).toBe(false);
  });
});

describe('controller commands respect the selected content', () => {
  it('reports one coherent identity and edits only the selected title with undo and redo', () => {
    const editor = factory.create({ kind: 'email', source });
    try {
      const before = editor.session.snapshot();
      const title = find(before.nodes, (node) => node.attrs?.id === 'title');
      const eyebrow = find(before.nodes, (node) => node.attrs?.id === 'eyebrow');
      const body = find(before.nodes, (node) => node.attrs?.id === 'body');
      expect(editor.controller.select(title.id)).toBe(true);
      expect(editor.controller.selected()).toMatchObject({
        id: title.id,
        tag: 'h2',
        label: 'Title marked',
        node: title,
      });
      expect(editor.controller.beginRichText(title.id)).toBe(true);
      expect(editor.session.getState().pendingRichText?.id).toBe(title.id);
      expect(editor.controller.updateRichTextDraft('<p>Changed <strong>title</strong></p>')).toBe(
        true,
      );
      expect(editor.controller.commitRichText()).toBe(true);
      const updated = editor.session.snapshot();
      expect(find(updated.nodes, (node) => node.id === eyebrow.id)).toEqual(eyebrow);
      expect(find(updated.nodes, (node) => node.id === body.id)).toEqual(body);
      expect(find(updated.nodes, (node) => node.id === title.id).attrs).toEqual(title.attrs);
      expect(editor.controller.richTextFor(title.id)).toBe('<p>Changed <strong>title</strong></p>');
      expect(editor.controller.undo()).toBe(true);
      expect(editor.controller.richTextFor(title.id)).toBe('<p>Title <strong>marked</strong></p>');
      expect(editor.controller.redo()).toBe(true);
      expect(editor.controller.richTextFor(title.id)).toBe('<p>Changed <strong>title</strong></p>');
    } finally {
      editor.dispose();
    }
  });

  it('projects inline link identity for verified presentation without document styles', () => {
    const editor = factory.create({
      source: { html: '<p>Read <a href="https://example.com">details</a></p>', css: '' },
    });
    try {
      const nodes = editor.session.snapshot().nodes;
      const paragraph = find(nodes, (node) => node.tag === 'p');
      const anchor = find(nodes, (node) => node.tag === 'a');
      expect(editor.controller.richTextFor(paragraph.id)).toBe(
        `<p>Read <a href="https://example.com" data-editor-rich-origin="${anchor.id}">details</a></p>`,
      );
    } finally {
      editor.dispose();
    }
  });

  it('does not expose a composed container as one editable rich-text value', () => {
    const editor = factory.create({ kind: 'email', source });
    try {
      const row = find(editor.session.snapshot().nodes, (node) => node.attrs?.id === 'composed');
      const composed = find(row.children ?? [], (node) => node.tag === 'div');
      expect(editor.controller.select(composed.id)).toBe(true);
      expect(editor.controller.propertyCapabilities()?.richText).toBe(false);
      expect(editor.controller.richTextFor(composed.id)).toBeUndefined();
      expect(editor.controller.beginRichText(composed.id)).toBe(false);
      expect(editor.controller.updateRichTextFor(composed.id, '<p>Replace all</p>')).toBe(false);
      expect(editor.session.exportSource()).toEqual(source);
    } finally {
      editor.dispose();
    }
  });

  it('offers image properties and replaces the exact selected asset while preserving its row and link', () => {
    const editor = factory.create({
      kind: 'email',
      source: {
        html: '<table role="presentation"><tbody><tr id="image-row"><td style="padding:18px"><a href="https://example.com"><img src="https://example.com/a.png" alt="Before"></a></td></tr></tbody></table>',
        css: '',
      },
    });
    try {
      const image = find(editor.session.snapshot().nodes, (node) => node.tag === 'img');
      expect(editor.controller.select(image.id)).toBe(true);
      expect(editor.controller.selected()).toMatchObject({
        id: image.id,
        tag: 'img',
        node: image,
        label: 'Before',
      });
      expect(editor.controller.propertyCapabilities()?.attributes).toEqual(
        expect.arrayContaining(['src', 'alt', 'width', 'height']),
      );
      expect(editor.controller.updateAttribute('alt', 'Changed')).toBe(true);
      expect(
        editor.controller.attachAsset(
          { id: 'asset-2', url: 'https://example.com/b.png', alt: 'New asset' },
          image.id,
        ),
      ).toBe(true);
      const updated = find(editor.session.snapshot().nodes, (node) => node.id === image.id);
      expect(updated.attrs).toMatchObject({
        src: 'https://example.com/b.png',
        alt: 'New asset',
        'data-host-asset-id': 'asset-2',
      });
      expect(editor.session.exportSource().html).toContain('style="padding:18px"');
      expect(editor.session.exportSource().html).toContain('href="https://example.com"');
      expect(editor.controller.undo()).toBe(true);
      expect(find(editor.session.snapshot().nodes, (node) => node.id === image.id).attrs?.alt).toBe(
        'Changed',
      );
    } finally {
      editor.dispose();
    }
  });

  it('reorders sibling text locally and retains the email envelope when moving to another row', () => {
    const editor = factory.create({ kind: 'email', source });
    try {
      const data = editor.session.snapshot();
      const title = find(data.nodes, (node) => node.attrs?.id === 'title');
      const body = find(data.nodes, (node) => node.attrs?.id === 'body');
      const tail = find(data.nodes, (node) => node.attrs?.id === 'tail');
      expect(editor.controller.moveTo(title.id, body.id, 'inside')).toBe(false);
      expect(editor.controller.moveTo(title.id, body.id, 'after')).toBe(true);
      const local = editor.session.exportSource().html;
      expect(local.indexOf('id="body"')).toBeLessThan(local.indexOf('id="title"'));
      expect(local.indexOf('id="composed"')).toBeLessThan(local.indexOf('id="tail"'));
      expect(editor.controller.moveTo(title.id, tail.id, 'after')).toBe(true);
      const html = editor.session.exportSource().html;
      expect(html.indexOf('id="tail"')).toBeLessThan(html.indexOf('id="composed"'));
      expect(html).toContain('style="padding:24px"');
      expect(html).toContain('Opening');
      expect(html).toContain('Body');
    } finally {
      editor.dispose();
    }
  });

  it('duplicates and removes only a title that shares its content parent with other blocks', () => {
    const editor = factory.create({ kind: 'email', source });
    try {
      const title = find(editor.session.snapshot().nodes, (node) => node.attrs?.id === 'title');
      editor.controller.select(title.id);
      expect(editor.controller.duplicate()).toBe(true);
      const count = (tag: string): number =>
        editor.controller.entries().filter((entry) => entry.tag === tag).length;
      expect(count('tr')).toBe(2);
      expect(count('h2')).toBe(2);
      editor.controller.select(title.id);
      expect(editor.controller.remove()).toBe(true);
      expect(count('tr')).toBe(2);
      expect(count('h2')).toBe(1);
      expect(editor.session.exportSource().html.match(/Opening/g)).toHaveLength(1);
      expect(editor.session.exportSource().html.match(/Body/g)).toHaveLength(1);
      expect(editor.session.exportSource().html).toContain('style="padding:24px"');
    } finally {
      editor.dispose();
    }
  });

  it('keeps a singleton heading in its structural email row for duplication and removal', () => {
    const editor = factory.create({
      kind: 'email',
      source: {
        html: '<table role="presentation"><tbody><tr id="singleton"><td style="padding:12px"><div><h2>Only title</h2></div></td></tr><tr><td>Tail</td></tr></tbody></table>',
        css: '',
      },
    });
    try {
      const title = find(editor.session.snapshot().nodes, (node) => node.tag === 'h2');
      editor.controller.select(title.id);
      expect(editor.controller.duplicate()).toBe(true);
      expect(editor.controller.entries().filter((entry) => entry.tag === 'tr')).toHaveLength(3);
      editor.controller.select(title.id);
      expect(editor.controller.remove()).toBe(true);
      expect(editor.controller.entries().filter((entry) => entry.tag === 'tr')).toHaveLength(2);
      expect(editor.session.exportSource().html.match(/Only title/g)).toHaveLength(1);
    } finally {
      editor.dispose();
    }
  });

  it('moves a selected title by keyboard among sibling content without moving its row', () => {
    const editor = factory.create({ kind: 'email', source });
    try {
      const title = find(editor.session.snapshot().nodes, (node) => node.attrs?.id === 'title');
      expect(editor.controller.applyCanvasAction(title.id, 'up')).toBe(true);
      let html = editor.session.exportSource().html;
      expect(html.indexOf('id="title"')).toBeLessThan(html.indexOf('id="eyebrow"'));
      expect(html.indexOf('id="composed"')).toBeLessThan(html.indexOf('id="tail"'));
      expect(editor.controller.applyCanvasAction(title.id, 'down')).toBe(true);
      html = editor.session.exportSource().html;
      expect(html.indexOf('id="eyebrow"')).toBeLessThan(html.indexOf('id="title"'));
    } finally {
      editor.dispose();
    }
  });

  it('provides valid contextual targets, isolates cached output and invalidates it after revision changes', () => {
    const editor = factory.create({ kind: 'email', source });
    try {
      const nodes = editor.session.snapshot().nodes;
      const title = find(nodes, (node) => node.attrs?.id === 'title');
      const body = find(nodes, (node) => node.attrs?.id === 'body');
      const targets = editor.controller.movementTargets(title.id);
      expect(targets.find((target) => target.targetId === body.id)?.placements).toEqual(['after']);
      expect(targets.some((target) => target.targetId === title.id)).toBe(false);
      Object.assign(targets[0] ?? {}, { targetId: 'forged' });
      expect(
        editor.controller.movementTargets(title.id).some((target) => target.targetId === 'forged'),
      ).toBe(false);
      editor.controller.select(body.id);
      expect(editor.controller.remove()).toBe(true);
      expect(
        editor.controller.movementTargets(title.id).some((target) => target.targetId === body.id),
      ).toBe(false);
      editor.session.setReadOnly(true);
      expect(editor.controller.movementTargets(title.id)).toEqual([]);
    } finally {
      editor.dispose();
    }
  });

  it('recovers a title draft by its content identity instead of its movement row', async () => {
    const editor = factory.create({ kind: 'email', source });
    const reopened = factory.create({ kind: 'email' });
    try {
      const title = find(editor.session.snapshot().nodes, (node) => node.attrs?.id === 'title');
      expect(editor.controller.beginRichText(title.id)).toBe(true);
      expect(editor.controller.updateRichTextDraft('<p>Recovered title</p>')).toBe(true);
      expect(
        await reopened.controller.importFile(
          new File([editor.controller.exportRecovery()], 'recovery.json'),
        ),
      ).toBe(true);
      expect(reopened.session.getState().pendingRichText?.id).toBe(title.id);
      expect(reopened.controller.richTextFor(title.id)).toBe('<p>Recovered title</p>');
      expect(reopened.controller.commitRichText()).toBe(true);
      expect(reopened.session.exportSource().html).toContain('Recovered title');
      expect(reopened.session.exportSource().html).toContain('Opening');
    } finally {
      editor.dispose();
      reopened.dispose();
    }
  });

  it('rejects readonly changes without altering composed content', () => {
    const editor = factory.create({ kind: 'email', source, readOnly: true });
    try {
      const before = editor.session.snapshot();
      const title = find(before.nodes, (node) => node.attrs?.id === 'title');
      expect(editor.controller.select(title.id)).toBe(true);
      expect(editor.controller.beginRichText(title.id)).toBe(false);
      expect(editor.controller.updateStyle('color', '#abcdef')).toBe(false);
      expect(editor.controller.duplicate()).toBe(false);
      expect(editor.controller.remove()).toBe(false);
      expect(editor.session.snapshot()).toEqual(before);
    } finally {
      editor.dispose();
    }
  });
});
