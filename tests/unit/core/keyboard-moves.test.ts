import { describe, expect, it } from 'vitest';
import { EditorFactory } from '../../../src/composition/factory';
import type { DocumentNode } from '../../../src/core/document';

const factory = new EditorFactory(() => ({
  compile: async () => {
    throw new Error('NOT_USED');
  },
}));

function find(nodes: readonly DocumentNode[], id: string): DocumentNode {
  const search = (children: readonly DocumentNode[]): DocumentNode | undefined => {
    for (const node of children) {
      if (node.attrs?.id === id) return node;
      const nested = search(node.children ?? []);
      if (nested) return nested;
    }
    return undefined;
  };
  const result = search(nodes);
  if (!result) throw new Error(`MISSING_FIXTURE_NODE_${id}`);
  return result;
}

const PAGE = [
  '<main id="root">',
  '<section id="first" style="padding:8px"><h1 id="title">Título</h1><p id="lead">Abertura</p></section>',
  '<section id="second" style="padding:8px"><p id="inner">Dentro</p></section>',
  '<section id="empty" style="padding:8px"></section>',
  '</main>',
].join('');

/** Ids of the elements named in `ids`, in the order they appear in the exported HTML. */
function order(html: string, ids: readonly string[]): string[] {
  return [...ids].sort(
    (left, right) => html.indexOf(`id="${left}"`) - html.indexOf(`id="${right}"`),
  );
}

/** The id attribute of the element which holds `id`, read from the document tree. */
function parentOf(nodes: readonly DocumentNode[], id: string, holder?: string): string | undefined {
  for (const node of nodes) {
    if (node.attrs?.id === id) return holder;
    const nested = parentOf(node.children ?? [], id, node.attrs?.id);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

describe('moving a block by keyboard across containers', () => {
  it('leaves its container at the edges and enters the neighbouring container', () => {
    const editor = factory.create({ kind: 'page', source: { html: PAGE, css: '' } });
    try {
      const id = (name: string) => find(editor.session.snapshot().nodes, name).id;
      const html = () => editor.session.exportSource().html;
      const lead = id('lead');
      // Last child of the first section, going down: it leaves the section, after it.
      expect(editor.controller.applyCanvasAction(lead, 'down')).toBe(true);
      expect(parentOf(editor.session.snapshot().nodes, 'lead')).toBe('root');
      expect(order(html(), ['first', 'lead', 'second'])).toEqual(['first', 'lead', 'second']);
      // Next to a section, going down: it enters it, at its top.
      expect(editor.controller.applyCanvasAction(lead, 'down')).toBe(true);
      expect(parentOf(editor.session.snapshot().nodes, 'lead')).toBe('second');
      expect(order(html(), ['lead', 'inner'])).toEqual(['lead', 'inner']);
      // Going up from the top of the section, it leaves it before the section.
      expect(editor.controller.applyCanvasAction(lead, 'up')).toBe(true);
      expect(parentOf(editor.session.snapshot().nodes, 'lead')).toBe('root');
      expect(order(html(), ['first', 'lead', 'second'])).toEqual(['first', 'lead', 'second']);
      // Going up into the section above, it lands at its end.
      expect(editor.controller.applyCanvasAction(lead, 'up')).toBe(true);
      expect(parentOf(editor.session.snapshot().nodes, 'lead')).toBe('first');
      expect(order(html(), ['title', 'lead'])).toEqual(['title', 'lead']);
    } finally {
      editor.dispose();
    }
  });

  it('enters an empty container and keeps every move as one step of undo', () => {
    const editor = factory.create({ kind: 'page', source: { html: PAGE, css: '' } });
    try {
      const inner = find(editor.session.snapshot().nodes, 'inner').id;
      const before = editor.session.exportSource().html;
      expect(editor.controller.applyCanvasAction(inner, 'down')).toBe(true);
      expect(editor.controller.applyCanvasAction(inner, 'down')).toBe(true);
      expect(parentOf(editor.session.snapshot().nodes, 'inner')).toBe('empty');
      expect(editor.controller.undo()).toBe(true);
      expect(parentOf(editor.session.snapshot().nodes, 'inner')).toBe('root');
      expect(editor.controller.undo()).toBe(true);
      expect(editor.session.exportSource().html).toBe(before);
    } finally {
      editor.dispose();
    }
  });

  it('reorders containers among themselves instead of nesting them', () => {
    const editor = factory.create({ kind: 'page', source: { html: PAGE, css: '' } });
    try {
      const first = find(editor.session.snapshot().nodes, 'first').id;
      expect(editor.controller.applyCanvasAction(first, 'down')).toBe(true);
      const html = editor.session.exportSource().html;
      expect(parentOf(editor.session.snapshot().nodes, 'first')).toBe('root');
      expect(order(html, ['first', 'second'])).toEqual(['second', 'first']);
    } finally {
      editor.dispose();
    }
  });

  it('does nothing at the top of the piece', () => {
    const html = '<section id="first" style="padding:8px"><p>Um</p></section><p>Dois</p>';
    const editor = factory.create({ kind: 'page', source: { html, css: '' } });
    try {
      const first = find(editor.session.snapshot().nodes, 'first').id;
      const revision = editor.session.snapshot().revision;
      expect(editor.controller.applyCanvasAction(first, 'up')).toBe(false);
      expect(editor.session.snapshot().revision).toBe(revision);
    } finally {
      editor.dispose();
    }
  });
});

describe('moving a block by keyboard in an e-mail', () => {
  it('crosses from a section to the column of the section beside it', async () => {
    const { NodeMjmlCompiler } = await import('../../../src/compilation/node-compiler');
    const compiler = new NodeMjmlCompiler(
      new URL('../../../dist/server-worker.js', import.meta.url),
    );
    const editor = new EditorFactory(() => compiler).create({ kind: 'email' });
    try {
      const controller = editor.controller;
      const regionsWith = (text: string) =>
        controller.canvasRegions().filter((region) => JSON.stringify(region.node).includes(text));
      const placeholder = regionsWith('Escreva seu').at(-1);
      if (!placeholder) throw new Error('MISSING_PLACEHOLDER');
      // A section of its own, after the one of the initial text.
      expect(await controller.addBlock('section', placeholder.id, 'after')).toBe(true);
      const moved = regionsWith('Uma nova seção para sua mensagem.').at(-1);
      if (!moved) throw new Error('MISSING_SECTION_TEXT');
      const before = editor.session.exportSource().html;
      const order = () => {
        const html = editor.session.exportSource().html;
        return html.indexOf('Uma nova seção') < html.indexOf('Escreva seu');
      };
      expect(order()).toBe(false);
      // Up, out of its own section and into the column of the one above, after its text.
      expect(controller.applyCanvasAction(moved.id, 'up')).toBe(true);
      expect(editor.session.exportSource().html).not.toBe(before);
      expect(controller.undo()).toBe(true);
      expect(editor.session.exportSource().html).toBe(before);
    } finally {
      editor.dispose();
      compiler.dispose();
    }
  });
});
