import { describe, expect, it } from 'vitest';
import type { EditorDocumentData, SourceInput } from '../../../src/core/document';
import { MjmlEmailRenderer } from '../../../src/renderers/email-renderer';
import { PageRenderer } from '../../../src/renderers/page-renderer';
import { TemplateCatalog } from '../../../src/templates/catalog';
import { HtmlDocumentAssembler, PreviewDocument } from '../../../src/renderers/preview-document';
import { DocumentOutline } from '../../../src/vue/outline';
import { EditorTheme } from '../../../src/vue/theme';

const source: SourceInput = {
  html: '<article class="custom">Native content</article>',
  css: '.custom{color:teal}',
};
const document = (kind: 'email' | 'page'): EditorDocumentData => ({
  schemaVersion: 1,
  id: 'test-document',
  kind,
  revision: 2,
  title: 'Test',
  css: source.css,
  nodes: [
    {
      id: 'article',
      type: 'element',
      tag: 'article',
      attrs: { class: 'custom' },
      children: [{ id: 'text', type: 'text', value: 'Native content' }],
    },
  ],
});

describe('renderer preservation and catalog boundaries', () => {
  it('serializes imported email without invoking the MJML compiler', () => {
    let compilations = 0;
    let validations = 0;
    const renderer = new MjmlEmailRenderer(
      { export: () => source },
      {
        assertSafe: () => {
          validations++;
        },
      },
      {
        compile: async () => {
          compilations++;
          return '<p>Generated</p>';
        },
      },
    );
    expect(renderer.render(document('email'))).toEqual(source);
    expect(compilations).toBe(0);
    expect(validations).toBe(1);
  });

  it('rejects unsafe snapshots before invoking a serializer', () => {
    let serialized = false;
    const renderer = new PageRenderer(
      {
        export: () => {
          serialized = true;
          return source;
        },
      },
      {
        assertSafe: () => {
          throw new Error('UNSAFE_DOCUMENT');
        },
      },
    );
    expect(() => renderer.render(document('page'))).toThrow('UNSAFE_DOCUMENT');
    expect(serialized).toBe(false);
  });

  it('keeps page and email renderer contracts distinct', () => {
    const page = new PageRenderer({ export: () => source }, { assertSafe: () => undefined });
    expect(() => page.render(document('email'))).toThrow('renderer.kind_mismatch');
  });

  it('defines three templates for each kind and compiles only email', async () => {
    const compiled: string[] = [];
    const email = new MjmlEmailRenderer(
      { export: () => source },
      { assertSafe: () => undefined },
      {
        compile: async (mjml) => {
          compiled.push(mjml);
          return '<p>Email generated</p>';
        },
      },
    );
    const catalog = new TemplateCatalog(email);
    expect(catalog.list('page')).toHaveLength(3);
    expect(catalog.list('email')).toHaveLength(3);
    const page = await catalog.create('page-service');
    expect(page.html).toContain('data-host-slot="form"');
    expect(page.css).toContain('@media');
    expect(compiled).toHaveLength(0);
    await catalog.create('email-welcome');
    expect(compiled[0]).toContain('<mjml>');
    await catalog.createBlock('columns', 'email');
    expect(compiled[1]).toContain('<mj-column css-class="editor-layout-column">');
    await expect(catalog.create('unknown')).rejects.toThrow('template.not_found');
  });

  it('adds a restrictive preview CSP and never adds a script', () => {
    const assembler = new HtmlDocumentAssembler(
      { import: () => ({ document: document('page'), diagnostics: [] }) },
      { assertSafe: () => undefined },
    );
    const preview = new PreviewDocument(assembler).build(source, 'page');
    expect(preview).toContain("default-src 'none'");
    expect(preview).toContain("form-action 'none'");
    expect(preview).not.toContain('<script');
    expect(preview).toContain(source.css);
  });

  it('assembles full HTML without duplicating its root and embeds CSS in the head', () => {
    const assembler = new HtmlDocumentAssembler(
      { import: () => ({ document: document('page'), diagnostics: [] }) },
      { assertSafe: () => undefined },
    );
    const result = assembler.build(
      {
        html: '<!doctype html><html><head><title>Keep</title></head><body><p>One Piece</p></body></html>',
        css: 'p{color:teal}',
      },
      'page',
    );
    expect(result.match(/<html/g)).toHaveLength(1);
    expect(result.match(/<body/g)).toHaveLength(1);
    expect(result).toContain('<style>p{color:teal}</style></head>');
    expect(result).not.toContain('Content-Security-Policy');
  });

  it('blocks unsafe source before assembling preview or portable HTML', () => {
    const assembler = new HtmlDocumentAssembler(
      {
        import: () => ({
          diagnostics: [{ code: 'UNSAFE', severity: 'error', messageKey: 'diagnostic.unsafe' }],
        }),
      },
      { assertSafe: () => undefined },
    );
    expect(() => assembler.build(source, 'page')).toThrow('preview.invalid_document');
  });
});

describe('presentation projections', () => {
  it('projects plain labels without rendering source markup', () => {
    const outline = new DocumentOutline();
    const entries = outline.entries(document('page'));
    expect(entries[0]?.label).toBe('Native content');
    expect(entries[0]?.id).toBe('article');
    expect(outline.richText(document('page').nodes[0]!)).toBeUndefined();
  });

  it('permits supported rich text while retaining unsupported markup for HTML editing', () => {
    const outline = new DocumentOutline();
    const supported = {
      id: 'paragraph',
      type: 'element' as const,
      tag: 'p',
      children: [
        {
          id: 'bold',
          type: 'element' as const,
          tag: 'strong',
          children: [{ id: 't', type: 'text' as const, value: '<One Piece>' }],
        },
      ],
    };
    expect(outline.richText(supported)).toBe('<p><strong>&lt;One Piece&gt;</strong></p>');
    expect(
      outline.richText({
        ...supported,
        children: [
          {
            id: 'span',
            type: 'element',
            tag: 'span',
            attrs: { class: 'custom' },
            children: [{ id: 't', type: 'text', value: 'Keep me' }],
          },
        ],
      }),
    ).toBe('<p><span data-editor-rich-origin="span">Keep me</span></p>');
  });

  it('accepts independent branding tokens and rejects CSS injection', () => {
    expect(new EditorTheme({ accent: '#9632ab', radius: 4 }).variables()['--editor-radius']).toBe(
      '4px',
    );
    expect(() => new EditorTheme({ accent: 'url(https://example.com)' })).toThrow(
      'theme.invalid_color',
    );
    expect(() => new EditorTheme({ fontFamily: 'font; background:red' })).toThrow(
      'theme.invalid_font',
    );
  });
});
