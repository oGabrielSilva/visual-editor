import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NodeMjmlCompiler } from '../../../src/compilation/node-compiler';
import { EditorFactory } from '../../../src/composition/factory';
import type { EditorInstance } from '../../../src/composition/factory';
import type { DocumentNode, EditorDocumentData } from '../../../src/core/document';
import { BLANK_EMAIL_MJML } from '../../../src/templates/catalog';

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

const create = (options: Parameters<EditorFactory['create']>[0]): EditorInstance => {
  const editor = factory.create(options);
  editors.push(editor);
  return editor;
};
const all = (nodes: readonly DocumentNode[]): DocumentNode[] =>
  nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
const text = (node: DocumentNode): string =>
  node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(text).join('');
const hasClass = (node: DocumentNode, name: string): boolean =>
  (node.attrs?.class ?? '').split(' ').includes(name);
const sections = (document: EditorDocumentData): DocumentNode[] =>
  all(document.nodes).filter((node) => hasClass(node, 'editor-layout-section'));
const wrapper = (document: EditorDocumentData): DocumentNode | undefined =>
  all(document.nodes).find((node) => node.attrs?.role === 'article');
/** Visible texts of the message in document order, one entry per content block. */
const reading = (document: EditorDocumentData): string[] => {
  const body = all(document.nodes).find((node) => node.tag === 'body');
  return all(body ? [body] : document.nodes)
    .filter((node) => node.type === 'text' && !!node.value?.trim())
    .map((node) => (node.value ?? '').trim());
};
const reimports = (editor: EditorInstance): void => {
  const source = editor.session.exportSource();
  const again = create({ kind: 'email', source });
  expect(again.session.getState().diagnostics.filter((item) => item.severity === 'error')).toEqual(
    [],
  );
  expect(again.session.exportSource()).toEqual(source);
};

describe('a new e-mail is born with the structure of an e-mail', () => {
  it('stores exactly what the compiler produces for the blank MJML', async () => {
    const editor = create({ kind: 'email' });
    expect(editor.templates.blank('email').html).toBe(await compiler.compile(BLANK_EMAIL_MJML));
    expect(editor.session.exportSource()).toEqual(editor.templates.blank('email'));
  }, 35_000);

  it('starts as one section with one column and one editable text, without sample metadata', () => {
    const editor = create({ kind: 'email' });
    const document = editor.session.snapshot();
    expect(editor.session.getState().diagnostics).toEqual([]);
    expect(wrapper(document)).toBeDefined();
    expect(sections(document)).toHaveLength(1);
    expect(
      all(document.nodes).filter((node) => hasClass(node, 'editor-layout-column')),
    ).toHaveLength(1);
    expect(reading(document)).toEqual(['Escreva seu conteúdo.']);
    // Nothing a recipient would receive by accident: no title and no preheader.
    expect(document.title).toBe('');
    expect(editor.session.documentMetadata()).toEqual({ title: '', preheader: '' });
    const html = editor.session.exportSource().html;
    expect(html).toContain('<title></title>');
    expect(html).not.toContain('display:none');
    expect(html).not.toContain('Mensagem de exemplo');
    const editable = editor.controller
      .canvasRegions()
      .filter((region) => region.editable)
      .map((region) => text(region.node).trim());
    expect(editable).toEqual(['Escreva seu conteúdo.']);
    // A page still starts as a paragraph, and an explicit source is never replaced.
    expect(create({ kind: 'page' }).session.exportSource().html).toBe(
      '<p>Escreva seu conteúdo.</p>',
    );
    expect(
      create({ kind: 'email', source: { html: '<p>Meu</p>', css: '' } }).session.exportSource()
        .html,
    ).toBe('<p>Meu</p>');
  });

  it('takes sections above and below the first one and moves them', async () => {
    const editor = create({ kind: 'email' });
    const first = sections(editor.session.snapshot())[0];
    if (!first) throw new Error('Missing section');
    expect(await editor.controller.addBlock('heading', first.id, 'before')).toBe(true);
    expect(await editor.controller.addBlock('button', first.id, 'after')).toBe(true);
    let document = editor.session.snapshot();
    expect(wrapper(document)).toBeDefined();
    expect(sections(document)).toHaveLength(3);
    expect(reading(document)).toEqual([
      'Seu próximo título',
      'Escreva seu conteúdo.',
      'Saiba mais',
    ]);
    reimports(editor);
    // The original section goes below the button, then back above everything.
    const [, original, button] = sections(document);
    if (!original || !button) throw new Error('Missing sections');
    expect(editor.controller.moveTo(original.id, button.id, 'after')).toBe(true);
    document = editor.session.snapshot();
    expect(reading(document)).toEqual([
      'Seu próximo título',
      'Saiba mais',
      'Escreva seu conteúdo.',
    ]);
    const heading = sections(document)[0];
    if (!heading) throw new Error('Missing heading section');
    expect(editor.controller.moveTo(original.id, heading.id, 'before')).toBe(true);
    expect(reading(editor.session.snapshot())).toEqual([
      'Escreva seu conteúdo.',
      'Seu próximo título',
      'Saiba mais',
    ]);
    reimports(editor);
    // The Outlook ghost tables around each section stay balanced after every operation.
    const html = editor.session.exportSource().html;
    expect(html.split('<!--[if mso | IE]><table align="center"')).toHaveLength(4);
    expect(html.split('<!--[if mso | IE]></td></tr></table><![endif]-->').length).toBeGreaterThan(
      3,
    );
  }, 60_000);

  it('takes content above and below the initial text inside its column', async () => {
    const editor = create({ kind: 'email' });
    const initial = editor.controller.canvasRegions().find((region) => region.editable);
    if (!initial) throw new Error('Missing text region');
    expect(await editor.controller.addBlock('text', initial.id, 'before')).toBe(true);
    const anchor = editor.controller
      .canvasRegions()
      .find((region) => region.editable && text(region.node).trim() === 'Escreva seu conteúdo.');
    if (!anchor) throw new Error('Missing text region');
    expect(await editor.controller.addBlock('button', anchor.id, 'after')).toBe(true);
    const document = editor.session.snapshot();
    expect(sections(document)).toHaveLength(1);
    expect(reading(document)).toEqual([
      'Escreva uma mensagem para sua próxima conversa.',
      'Escreva seu conteúdo.',
      'Saiba mais',
    ]);
    reimports(editor);
  }, 60_000);

  it('edits the title and the preheader as document content', () => {
    const editor = create({ kind: 'email' });
    expect(editor.session.updateTitle('Novidades de novembro')).toBe(true);
    expect(editor.session.updatePreheader('Tudo que mudou este mês')).toBe(true);
    expect(editor.session.documentMetadata()).toEqual({
      title: 'Novidades de novembro',
      preheader: 'Tudo que mudou este mês',
    });
    let html = editor.session.exportSource().html;
    expect(html).toContain('<title>Novidades de novembro</title>');
    expect(html).toContain(
      '<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">Tudo que mudou este mês</div>',
    );
    // Replaced, never multiplied; reopened from the source it is still read as metadata.
    expect(editor.session.updatePreheader('Outro <b>texto</b> & mais')).toBe(true);
    html = editor.session.exportSource().html;
    expect(html.split('display:none')).toHaveLength(2);
    expect(html).toContain('Outro &lt;b&gt;texto&lt;/b&gt; &amp; mais</div>');
    const reopened = create({ kind: 'email', source: editor.session.exportSource() });
    expect(reopened.session.documentMetadata()).toEqual({
      title: 'Novidades de novembro',
      preheader: 'Outro <b>texto</b> & mais',
    });
    expect(editor.session.updatePreheader('')).toBe(true);
    expect(editor.session.exportSource().html).not.toContain('display:none');
    expect(editor.session.updateTitle('')).toBe(true);
    expect(editor.session.exportSource().html).toContain('<title></title>');
    expect(editor.session.updateTitle('a\u0000b')).toBe(false);
    expect(editor.session.undo()).toBe(true);
    expect(editor.session.documentMetadata()?.title).toBe('Novidades de novembro');
    // A page has a title and no preheader.
    const page = create({ kind: 'page' });
    expect(page.session.documentMetadata()).toEqual({ title: '', preheader: undefined });
    expect(page.session.updatePreheader('x')).toBe(false);
    expect(page.session.updateTitle('Minha página')).toBe(true);
    expect(page.session.snapshot().title).toBe('Minha página');
  });

  it('keeps the catalog models free of a sample title and preheader', async () => {
    const editor = create({ kind: 'email' });
    for (const template of editor.templates.list('email')) {
      const source = await editor.templates.create(template.id);
      expect(source.html, template.id).toContain('<title></title>');
      expect(source.html, template.id).not.toContain('display:none');
      expect(source.html, template.id).not.toContain('Uma mensagem para sua próxima conversa.');
    }
  }, 60_000);
});

describe('an imported e-mail without a recognized structure', () => {
  it('takes a block as a sibling in the flow of the body, before or after the target', async () => {
    const editor = create({
      kind: 'email',
      source: { html: '<p>Primeiro</p><p>Segundo</p>', css: '' },
    });
    const paragraphs = (): DocumentNode[] =>
      all(editor.session.snapshot().nodes).filter((node) => node.tag === 'p');
    const [first, second] = paragraphs();
    if (!first || !second) throw new Error('Missing paragraphs');
    expect(await editor.controller.addBlock('button', first.id, 'after')).toBe(true);
    expect(reading(editor.session.snapshot())).toEqual(['Primeiro', 'Saiba mais', 'Segundo']);
    expect(await editor.controller.addBlock('heading', first.id, 'before')).toBe(true);
    expect(reading(editor.session.snapshot())).toEqual([
      'Seu próximo título',
      'Primeiro',
      'Saiba mais',
      'Segundo',
    ]);
    expect(await editor.controller.addBlock('text', second.id, 'after')).toBe(true);
    expect(reading(editor.session.snapshot())).toEqual([
      'Seu próximo título',
      'Primeiro',
      'Saiba mais',
      'Segundo',
      'Escreva uma mensagem para sua próxima conversa.',
    ]);
    // The paragraphs of the author are still top-level siblings of the inserted sections.
    const roots = editor.session.snapshot().nodes.filter((node) => node.type === 'element');
    expect(roots.filter((node) => node.tag === 'p').map(text)).toEqual(['Primeiro', 'Segundo']);
    expect(roots.filter((node) => hasClass(node, 'editor-layout-section'))).toHaveLength(3);
    reimports(editor);
  }, 60_000);

  it('does the same inside the body of a complete imported document', async () => {
    const editor = create({
      kind: 'email',
      source: {
        html: '<!doctype html><html><head><title>Carta</title></head><body><p>Primeiro</p><p>Segundo</p></body></html>',
        css: '',
      },
    });
    const first = all(editor.session.snapshot().nodes).find((node) => node.tag === 'p');
    if (!first) throw new Error('Missing paragraph');
    expect(await editor.controller.addBlock('image', first.id, 'after')).toBe(true);
    expect(await editor.controller.addBlock('text', first.id, 'before')).toBe(true);
    const body = all(editor.session.snapshot().nodes).find((node) => node.tag === 'body');
    const flow = (body?.children ?? [])
      .filter((node) => node.type === 'element')
      .map((node) => (node.tag === 'p' ? text(node) : hasClass(node, 'editor-layout-section')));
    expect(flow).toEqual([true, 'Primeiro', true, 'Segundo']);
    expect(editor.session.documentMetadata()?.title).toBe('Carta');
    reimports(editor);
  }, 60_000);
});
