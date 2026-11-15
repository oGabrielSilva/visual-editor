import { describe, expect, it } from 'vitest';
import mjml2html from 'mjml';
import { EditorFactory } from '../../../src/composition/factory';
import type { DocumentNode } from '../../../src/core/document';
import type { SectionLayoutPatch } from '../../../src/core/section-layout';
import { SECTION_LAYOUT_PRESETS, SectionLayoutPolicy } from '../../../src/core/section-layout';
import { CssDocumentCodec } from '../../../src/codecs/css';
import { CompilationGuard, MJML_OPTIONS } from '../../../src/compilation/guard';

const guard = new CompilationGuard();
const compile = async (source: string): Promise<string> => {
  guard.source(source);
  return guard.output((await mjml2html(source, MJML_OPTIONS)).html);
};
const factory = new EditorFactory(() => ({ compile }));
const all = (nodes: readonly DocumentNode[]): readonly DocumentNode[] =>
  nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
function find(
  nodes: readonly DocumentNode[],
  predicate: (node: DocumentNode) => boolean,
): DocumentNode {
  const node = all(nodes).find(predicate);
  if (!node) throw new Error('MISSING_FIXTURE_NODE');
  return node;
}
const pageSource = {
  html: '<main><section id="offer" class="columns custom" data-editor-block="columns" style="display:grid;grid-template-columns:1fr 1fr!important;gap:24px;--brand:teal"><article class="card"><h2 id="title">First</h2><p>Body</p></article><article class="card"><p>Second</p></article></section><aside data-unknown="retained">Untouched</aside><!--[if mso]><p>Safe legacy</p><![endif]--></main>',
  css: '.custom{border:2px solid teal}.card{letter-spacing:.03em}@media(max-width:640px){.columns{grid-template-columns:1fr}}',
};

describe('semantic section layout invariants', () => {
  it('changes proportions and mobile stacking without modifying content, CSS unknown to the editor, or neighboring HTML', async () => {
    const editor = factory.create({ source: pageSource });
    try {
      const before = editor.session.snapshot();
      const section = find(before.nodes, (node) => node.attrs?.id === 'offer');
      const title = find(before.nodes, (node) => node.attrs?.id === 'title');
      editor.controller.select(title.id);
      expect(editor.controller.layoutSettings()).toMatchObject({
        id: section.id,
        ratios: [1, 1],
        editable: true,
        stacking: 'normal',
        breakpoint: 640,
      });
      expect(
        await editor.controller.updateLayout({
          ratios: [2, 1],
          stacking: 'reverse',
          breakpoint: 480,
        }),
      ).toBe(true);
      const after = editor.session.snapshot();
      expect(after.revision).toBe(before.revision + 1);
      expect(find(after.nodes, (node) => node.id === title.id)).toEqual(title);
      expect(find(after.nodes, (node) => node.id === section.id).children).toEqual(
        section.children,
      );
      expect(find(after.nodes, (node) => node.tag === 'aside')).toEqual(
        find(before.nodes, (node) => node.tag === 'aside'),
      );
      expect(find(after.nodes, (node) => node.id === section.id).attrs).toMatchObject({
        id: 'offer',
        class: 'columns custom',
        'data-editor-layout-ratios': '2-1',
        'data-editor-layout-stacking': 'reverse',
      });
      expect(find(after.nodes, (node) => node.id === section.id).attrs?.style).toContain(
        '--brand:teal',
      );
      expect(find(after.nodes, (node) => node.id === section.id).attrs?.style).not.toContain(
        'grid-template-columns',
      );
      expect(after.css).toContain(pageSource.css);
      expect(after.css).toContain('minmax(0,2fr) minmax(0,1fr)!important');
      expect(after.css).toMatch(/@media\s*\(max-width:480px\)/);
      expect(after.css).toContain('flex-direction:column-reverse!important');
      expect(editor.session.exportSource().html).toContain(
        '<!--[if mso]><p>Safe legacy</p><![endif]-->',
      );
      expect(editor.controller.undo()).toBe(true);
      expect(editor.session.exportSource()).toEqual(pageSource);
      expect(editor.controller.redo()).toBe(true);
      expect(editor.controller.layoutSettings()?.ratios).toEqual([2, 1]);
      const reopened = factory.create({ source: editor.session.exportSource() });
      try {
        reopened.controller.select(
          find(reopened.session.snapshot().nodes, (node) => node.attrs?.id === 'title').id,
        );
        expect(reopened.controller.layoutSettings()).toMatchObject({
          ratios: [2, 1],
          stacking: 'reverse',
          breakpoint: 480,
        });
      } finally {
        reopened.dispose();
      }
    } finally {
      editor.dispose();
    }
  });

  it('adds an empty column with a fresh identity and removes only the empty trailing column', async () => {
    const editor = factory.create({ source: pageSource });
    try {
      const section = find(editor.session.snapshot().nodes, (node) => node.attrs?.id === 'offer');
      editor.controller.select(section.id);
      const original = editor.controller.layoutSettings()?.columnIds;
      expect(await editor.controller.updateLayout({ ratios: [1, 1, 1] })).toBe(true);
      const three = editor.controller.layoutSettings();
      expect(three?.columnIds.slice(0, 2)).toEqual(original);
      expect(three?.removableColumnIds).toEqual([three?.columnIds[2]]);
      const identifiers = all(editor.session.snapshot().nodes).map((node) => node.id);
      expect(new Set(identifiers).size).toBe(identifiers.length);
      expect(await editor.controller.updateLayout({ ratios: [1, 1] })).toBe(true);
      expect(editor.controller.layoutSettings()?.columnIds).toEqual(original);
      expect(await editor.controller.updateLayout({ ratios: [1] })).toBe(false);
      expect(editor.controller.state().diagnostics[0]?.code).toBe('LAYOUT_COLUMN_NOT_EMPTY');
      expect(editor.controller.layoutSettings()?.columnIds).toEqual(original);
    } finally {
      editor.dispose();
    }
  });

  it('refuses deleting a populated or identity-bearing empty column without changing source, revision or history', async () => {
    for (const second of [
      '<article><img src="https://example.com/image.png" alt="Safe"></article>',
      '<article id="anchor"></article>',
      '<article><!--Keep this comment--></article>',
    ]) {
      const editor = factory.create({
        source: {
          html: `<section class="columns"><article><p>First</p></article>${second}</section>`,
          css: '',
        },
      });
      try {
        editor.controller.select(
          find(editor.session.snapshot().nodes, (node) => node.tag === 'section').id,
        );
        const before = editor.session.snapshot();
        const source = editor.session.exportSource();
        expect(await editor.controller.updateLayout({ ratios: [1] })).toBe(false);
        expect(editor.session.snapshot()).toEqual(before);
        expect(editor.session.exportSource()).toEqual(source);
        expect(editor.session.getState().canUndo).toBe(false);
      } finally {
        editor.dispose();
      }
    }
  });

  it('validates runtime settings and refuses foreign/forged layout structures', async () => {
    const editor = factory.create({ source: pageSource });
    try {
      editor.controller.select(
        find(editor.session.snapshot().nodes, (node) => node.tag === 'section').id,
      );
      const before = editor.session.snapshot();
      for (const patch of [
        { ratios: [] },
        { ratios: [0, 1] },
        { ratios: [13, 1] },
        { ratios: [1, 1, 1, 1, 1] },
        { breakpoint: 1 },
        { stacking: 'url(javascript:bad)' },
        { styles: 'display:none' },
      ])
        expect(await editor.controller.updateLayout(patch as unknown as SectionLayoutPatch)).toBe(
          false,
        );
      expect(editor.session.snapshot()).toEqual(before);
      expect(editor.session.getState().canUndo).toBe(false);
    } finally {
      editor.dispose();
    }
    const foreign = factory.create({
      kind: 'email',
      source: {
        html: '<div class="editor-layout-section" data-editor-layout="columns"><p>Native imported content</p></div>',
        css: '',
      },
    });
    try {
      const node = find(foreign.session.snapshot().nodes, (candidate) => candidate.tag === 'p');
      foreign.controller.select(node.id);
      expect(foreign.controller.layoutSettings()).toBeUndefined();
      expect(await foreign.controller.updateLayout({ ratios: [1, 1] })).toBe(false);
      expect(foreign.session.getState().canUndo).toBe(false);
    } finally {
      foreign.dispose();
    }
  });

  it('blocks readonly edits and discards a result when selection changes before the async transaction commits', async () => {
    const editor = factory.create({ source: pageSource });
    try {
      const section = find(editor.session.snapshot().nodes, (node) => node.tag === 'section');
      editor.controller.select(section.id);
      editor.session.setReadOnly(true);
      expect(editor.controller.layoutSettings()).toMatchObject({
        editable: false,
        reason: 'readonly',
      });
      expect(await editor.controller.updateLayout({ ratios: [2, 1] })).toBe(false);
      editor.session.setReadOnly(false);
      const before = editor.session.snapshot();
      const pending = editor.controller.updateLayout({ ratios: [2, 1] });
      editor.controller.select(find(before.nodes, (node) => node.tag === 'aside').id);
      expect(await pending).toBe(false);
      expect(editor.session.snapshot()).toEqual(before);
      expect(editor.session.getState().canUndo).toBe(false);
    } finally {
      editor.dispose();
    }
  });

  it('makes catalog columns responsive before the first edit and exposes the existing semantic presets', async () => {
    const editor = factory.create();
    try {
      const source = await editor.templates.createBlock('columns', 'page');
      expect(source.html).not.toContain('grid-template-columns:');
      expect(source.css).toContain('@media(max-width:640px)');
      expect(SECTION_LAYOUT_PRESETS.map((preset) => preset.ratios.length)).toEqual([
        1, 2, 2, 2, 3, 4,
      ]);
    } finally {
      editor.dispose();
    }
  });

  it('removes only canonical AST declarations, including escaped names, while preserving other inline CSS', () => {
    const codec = new CssDocumentCodec();
    const source =
      'color:teal;g\\72 id-template-columns:1fr 1fr!important;--custom:"keep;value";gap:24px';
    const result = codec.removeDeclarations(source, ['grid-template-columns']);
    expect(result).toContain('color:teal');
    expect(result).toContain('--custom:"keep;value"');
    expect(result).toContain('gap:24px');
    expect(
      codec.inspect(result, 'declarationList').declarations['grid-template-columns'],
    ).toBeUndefined();
    expect(codec.validate(result, 'declarationList')).toEqual([]);
  });
});

describe('generated MJML section scaffold', () => {
  async function emailSource() {
    const editor = factory.create({ kind: 'email' });
    try {
      const source = await editor.templates.createBlock('columns', 'email');
      return {
        ...source,
        html: source.html.replace(
          'Primeira coluna',
          '<span id="inside" class="legacy" style="color:teal">Primeira coluna</span><!--[if mso]><p>Legacy column content</p><![endif]-->',
        ),
      };
    } finally {
      editor.dispose();
    }
  }

  it('recompiles only a recognized shell and preserves each column body, its identities and conditional content', async () => {
    const source = await emailSource();
    const editor = factory.create({
      kind: 'email',
      source: { ...source, css: '.legacy{letter-spacing:.03em}' },
    });
    try {
      const policy = new SectionLayoutPolicy();
      const before = editor.session.snapshot();
      const section = find(before.nodes, (node) => policy.hasClass(node, 'editor-layout-section'));
      editor.controller.select(section.id);
      const projection = policy.projection(before, section.id);
      expect(projection).toBeDefined();
      const bodies = projection?.columns.map((column) => policy.columnBody(column));
      const context = editor.controller.layoutSettings();
      expect(context).toMatchObject({ editable: true, ratios: [1, 1] });
      expect(
        await editor.controller.updateLayout({
          ratios: [2, 1],
          breakpoint: 768,
          stacking: 'normal',
        }),
      ).toBe(true);
      const after = editor.session.snapshot();
      expect(editor.controller.layoutSettings()?.columnIds).toEqual(context?.columnIds);
      expect(
        policy.projection(after, section.id)?.columns.map((column) => policy.columnBody(column)),
      ).toEqual(bodies);
      expect(find(after.nodes, (node) => node.attrs?.id === 'inside')).toEqual(
        find(before.nodes, (node) => node.attrs?.id === 'inside'),
      );
      const output = editor.session.exportSource();
      expect(output.html).toContain('<!--[if mso]><p>Legacy column content</p><![endif]-->');
      expect(output.html).toContain('width:400px');
      expect(output.html).toContain('width:200px');
      expect(after.css).toContain('.legacy{letter-spacing:.03em}');
      expect(after.css).toMatch(/@media\s*\(max-width:768px\)/);
      expect(after.revision).toBe(before.revision + 1);
      const ids = all(after.nodes).map((node) => node.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(editor.controller.undo()).toBe(true);
      expect(editor.session.exportSource().html).toBe(source.html);
      expect(editor.controller.redo()).toBe(true);
      const reopened = factory.create({ kind: 'email', source: editor.session.exportSource() });
      try {
        reopened.controller.select(
          find(reopened.session.snapshot().nodes, (node) => node.attrs?.id === 'inside').id,
        );
        expect(reopened.controller.layoutSettings()).toMatchObject({
          editable: true,
          ratios: [2, 1],
          breakpoint: 768,
        });
      } finally {
        reopened.dispose();
      }
    } finally {
      editor.dispose();
    }
  });

  it('adds and removes an empty MJML column without rebuilding existing content', async () => {
    const editor = factory.create({ kind: 'email', source: await emailSource() });
    try {
      const policy = new SectionLayoutPolicy();
      const before = editor.session.snapshot();
      const section = find(before.nodes, (node) => policy.hasClass(node, 'editor-layout-section'));
      editor.controller.select(section.id);
      const ids = editor.controller.layoutSettings()?.columnIds;
      expect(await editor.controller.updateLayout({ ratios: [1, 1, 1], stacking: 'none' })).toBe(
        true,
      );
      const context = editor.controller.layoutSettings();
      expect(context?.columnIds.slice(0, 2)).toEqual(ids);
      expect(context?.removableColumnIds).toEqual([context?.columnIds[2]]);
      expect(editor.session.snapshot().css).not.toContain('flex-direction:column');
      expect(await editor.controller.updateLayout({ ratios: [1, 1], stacking: 'reverse' })).toBe(
        true,
      );
      expect(editor.controller.layoutSettings()?.columnIds).toEqual(ids);
      expect(editor.session.snapshot().css).toContain('flex-direction:column-reverse');
      expect(await editor.controller.updateLayout({ ratios: [1] })).toBe(false);
      expect(editor.session.getState().diagnostics[0]?.code).toBe('LAYOUT_COLUMN_NOT_EMPTY');
    } finally {
      editor.dispose();
    }
  });

  it('refuses a native conditional embedded in the shell, retaining its source and last valid revision', async () => {
    const source = await emailSource();
    const policy = new SectionLayoutPolicy();
    const editor = factory.create({ kind: 'email', source });
    try {
      const document = editor.session.snapshot();
      const section = find(document.nodes, (node) =>
        policy.hasClass(node, 'editor-layout-section'),
      );
      const changed = {
        ...section,
        children: [
          {
            id: 'custom-conditional',
            type: 'comment' as const,
            value: '[if mso]><a href="https://example.com/legacy">Retain native HTML</a><![endif]',
          },
          ...(section.children ?? []),
        ],
      };
      const replace = (nodes: readonly DocumentNode[]): readonly DocumentNode[] =>
        nodes.map((node) =>
          node.id === section.id
            ? changed
            : node.children
              ? { ...node, children: replace(node.children) }
              : node,
        );
      expect(editor.session.importJson({ ...document, nodes: replace(document.nodes) })).toBe(true);
      editor.controller.select(section.id);
      const before = editor.session.snapshot();
      const output = editor.session.exportSource();
      expect(editor.controller.layoutSettings()).toMatchObject({
        editable: false,
        reason: 'unsupported-structure',
      });
      expect(await editor.controller.updateLayout({ ratios: [2, 1] })).toBe(false);
      expect(editor.session.snapshot()).toEqual(before);
      expect(editor.session.exportSource()).toEqual(output);
    } finally {
      editor.dispose();
    }
  });

  it('refuses an equivalent native section root instead of changing its HTML semantics', async () => {
    const source = await emailSource();
    const policy = new SectionLayoutPolicy();
    const editor = factory.create({ kind: 'email', source });
    try {
      const original = editor.session.snapshot();
      const section = find(original.nodes, (node) =>
        policy.hasClass(node, 'editor-layout-section'),
      );
      const replace = (nodes: readonly DocumentNode[]): readonly DocumentNode[] =>
        nodes.map((node) =>
          node.id === section.id
            ? { ...node, tag: 'section' }
            : node.children
              ? { ...node, children: replace(node.children) }
              : node,
        );
      expect(editor.session.importJson({ ...original, nodes: replace(original.nodes) })).toBe(true);
      expect(editor.controller.select(section.id)).toBe(true);
      const before = editor.session.snapshot();
      const output = editor.session.exportSource();
      const canUndo = editor.session.getState().canUndo;
      expect(editor.controller.layoutSettings()).toBeUndefined();
      expect(await editor.controller.updateLayout({ ratios: [2, 1] })).toBe(false);
      expect(editor.session.snapshot()).toEqual(before);
      expect(editor.session.exportSource()).toEqual(output);
      expect(editor.session.getState().canUndo).toBe(canUndo);
      expect(find(editor.session.snapshot().nodes, (node) => node.id === section.id).tag).toBe(
        'section',
      );
    } finally {
      editor.dispose();
    }
  });

  it('refuses noncanonical Outlook shell attribute values without discarding native presentation', async () => {
    const source = await emailSource();
    const policy = new SectionLayoutPolicy();
    for (const [name, value] of [
      ['border', '10'],
      ['cellpadding', '8'],
      ['cellspacing', '9'],
      ['align', 'right'],
      ['role', 'table'],
    ] as const) {
      const editor = factory.create({ kind: 'email', source });
      try {
        const original = editor.session.snapshot();
        const section = find(original.nodes, (node) =>
          policy.hasClass(node, 'editor-layout-section'),
        );
        const projection = policy.projection(original, section.id);
        const comment = projection?.shell
          ?.flatMap((node) => node.children ?? [])
          .find((node) => node.type === 'comment' && node.value?.includes('cellpadding="0"'));
        if (!comment) throw new Error('MISSING_MSO_SCAFFOLD');
        const current = comment.value ?? '';
        const changed =
          name === 'align'
            ? current.replace('<table ', `<table align="${value}" `)
            : current.replace(
                `${name}="${name === 'role' ? 'presentation' : '0'}"`,
                `${name}="${value}"`,
              );
        expect(changed).not.toBe(current);
        const replace = (nodes: readonly DocumentNode[]): readonly DocumentNode[] =>
          nodes.map((node) =>
            node.id === comment.id
              ? { ...node, value: changed }
              : node.children
                ? { ...node, children: replace(node.children) }
                : node,
          );
        expect(editor.session.importJson({ ...original, nodes: replace(original.nodes) })).toBe(
          true,
        );
        expect(editor.controller.select(section.id)).toBe(true);
        const before = editor.session.snapshot();
        const output = editor.session.exportSource();
        const canUndo = editor.session.getState().canUndo;
        expect(editor.controller.layoutSettings()).toMatchObject({
          editable: false,
          reason: 'unsupported-structure',
        });
        expect(await editor.controller.updateLayout({ ratios: [2, 1] })).toBe(false);
        expect(editor.session.snapshot()).toEqual(before);
        expect(editor.session.exportSource()).toEqual(output);
        expect(editor.session.getState().canUndo).toBe(canUndo);
        expect(find(editor.session.snapshot().nodes, (node) => node.id === comment.id).value).toBe(
          changed,
        );
      } finally {
        editor.dispose();
      }
    }
  });

  it('refuses an effective noncanonical shell width even when a later nonimportant declaration says 600px', async () => {
    const editor = factory.create({ kind: 'email', source: await emailSource() });
    const policy = new SectionLayoutPolicy();
    try {
      const original = editor.session.snapshot();
      const section = find(original.nodes, (node) =>
        policy.hasClass(node, 'editor-layout-section'),
      );
      const replace = (nodes: readonly DocumentNode[]): readonly DocumentNode[] =>
        nodes.map((node) =>
          node.id === section.id
            ? {
                ...node,
                attrs: {
                  ...node.attrs,
                  style: `${node.attrs?.style ?? ''};max-width:500px!important;max-width:600px`,
                },
              }
            : node.children
              ? { ...node, children: replace(node.children) }
              : node,
        );
      expect(editor.session.importJson({ ...original, nodes: replace(original.nodes) })).toBe(true);
      expect(editor.controller.select(section.id)).toBe(true);
      const before = editor.session.snapshot();
      const output = editor.session.exportSource();
      const canUndo = editor.session.getState().canUndo;
      expect(editor.controller.layoutSettings()).toMatchObject({
        editable: false,
        reason: 'unsupported-structure',
      });
      expect(await editor.controller.updateLayout({ ratios: [2, 1] })).toBe(false);
      expect(editor.session.snapshot()).toEqual(before);
      expect(editor.session.exportSource()).toEqual(output);
      expect(editor.session.getState().canUndo).toBe(canUndo);
    } finally {
      editor.dispose();
    }
  });

  it('does not commit a delayed compilation after readonly, another edit, or disposal', async () => {
    const source = await emailSource();
    for (const transition of ['readonly', 'revoked-and-restored', 'edit', 'dispose'] as const) {
      let release: ((html: string) => void) | undefined;
      let started = false;
      const delayedFactory = new EditorFactory(() => ({
        compile: async () => {
          started = true;
          return new Promise<string>((resolve) => {
            release = resolve;
          });
        },
      }));
      const editor = delayedFactory.create({ kind: 'email', source });
      const policy = new SectionLayoutPolicy();
      const before = editor.session.snapshot();
      const section = find(before.nodes, (node) => policy.hasClass(node, 'editor-layout-section'));
      editor.controller.select(section.id);
      const pending = editor.controller.updateLayout({ ratios: [2, 1] });
      expect(started).toBe(true);
      if (transition === 'readonly') editor.session.setReadOnly(true);
      else if (transition === 'revoked-and-restored') {
        editor.session.setReadOnly(true);
        editor.session.setReadOnly(false);
      } else if (transition === 'edit')
        editor.session.updateText(
          find(before.nodes, (node) => node.tag === 'span').id,
          'Newer edit',
        );
      else editor.dispose();
      const generated = await compile(
        '<mjml><mj-body><mj-section css-class="editor-layout-section"><mj-column css-class="editor-layout-column" width="66.6667%"></mj-column><mj-column css-class="editor-layout-column" width="33.3333%"></mj-column></mj-section></mj-body></mjml>',
      );
      release?.(generated);
      expect(await pending).toBe(false);
      if (transition !== 'dispose') {
        expect(editor.session.snapshot().css).toBe(before.css);
        expect(editor.session.getState().canUndo).toBe(transition === 'edit');
        editor.dispose();
      }
    }
  });
});
