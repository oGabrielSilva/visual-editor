import { describe, expect, it } from 'vitest';
import { BlockPageGenerator, styleVariable } from '../../../src/blocks/page-generator';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { ContentPolicy } from '../../../src/security/policy';
import { EDIT_NODE_ATTRIBUTE, NODE_ATTRIBUTE } from '../../../src/core/canvas-contract';
import { column, documentOf, registry, section, simple } from './support';

const generator = new BlockPageGenerator(registry);

const page = () =>
  documentOf(
    [
      section('s1', [
        column(
          'c1',
          [
            { id: 'h1', type: 'heading', props: { text: 'Título', level: 'h1', color: '#112233' } },
            { id: 't1', type: 'text', props: { text: '<p>Texto</p>' } },
            {
              id: 'b1',
              type: 'button',
              props: { text: 'Ir', href: '#form', background: '#ff0000' },
            },
          ],
          { weight: 2 },
        ),
        column('c2', [
          {
            id: 'i1',
            type: 'image',
            props: { url: 'https://x.y/a.png', alt: 'A', width: '200px' },
          },
          { id: 'd1', type: 'divider', props: { color: '#00ff00' } },
          { id: 'p1', type: 'spacer', props: {} },
        ]),
      ]),
      section('s2', [
        column('c3', [
          { id: 'f1', type: 'form', props: { reference: 'lead_1' } },
          { id: 'r1', type: 'html', props: { html: '<div>Livre</div><script>track()</script>' } },
          { id: 'o1', type: 'footer', props: { text: '<p>Rodapé</p>' } },
        ]),
      ]),
    ],
    'page',
    { meta: { lang: 'es' }, styles: { button: { background: '#0000ff' } } },
  );

describe('block page: generated HTML and CSS', () => {
  it('writes semantic HTML with real columns', () => {
    const { html } = generator.toHtml(page(), 'final');
    expect(html).toMatchSnapshot();
    expect(html.startsWith('<main class="ve-page" lang="es">')).toBe(true);
    expect(html).toContain('<h1 class="ve-block ve-heading ve-b-h1">Título</h1>');
    expect(html).toContain('<a class="ve-button" href="#form">Ir</a>');
    expect(html).toContain('<img src="https://x.y/a.png" alt="A">');
    expect(html).toContain('data-host-slot="form" data-host-reference="lead_1"');
    expect(html).toContain('<div>Livre</div><script>track()</script>');
    expect(html).toContain('<footer class="ve-block ve-footer ve-b-o1"><p>Rodapé</p></footer>');
  });

  it('turns global styles into variables and overrides into rules of the block class', () => {
    const { css } = generator.toHtml(page(), 'final');
    expect(css).toMatchSnapshot();
    expect(css.startsWith(':root{')).toBe(true);
    expect(css).toContain(`${styleVariable('button.background')}:#0000ff`);
    expect(css).toContain(`${styleVariable('body.textColor')}:#243746`);
    expect(css).toContain(`${styleVariable('section.columnGap')}:24px`);
    expect(css).toContain('.ve-b-h1{color:#112233}');
    expect(css).toContain('.ve-b-b1 .ve-button{background-color:#ff0000}');
    expect(css).toContain('.ve-b-i1 img{width:200px}');
    expect(css).toContain('.ve-b-d1 hr{border-top-color:#00ff00}');
    expect(css).toContain(
      '.ve-b-s1 > .ve-columns{grid-template-columns:minmax(0,2fr) minmax(0,1fr)}',
    );
    expect(
      css.endsWith(
        '@media (max-width:640px){.ve-section>.ve-columns{grid-template-columns:minmax(0,1fr)}}',
      ),
    ).toBe(true);
    expect(styleVariable('body.contentBackground')).toBe('--ve-body-content-background');
  });

  it('restoring a default removes the rule and the block inherits again', () => {
    const restored = page().restoreDefault('b1', ['background']).restoreStyleDefault('button');
    const { css } = generator.toHtml(restored, 'final');
    expect(css).not.toContain('.ve-b-b1 .ve-button');
    expect(css).toContain(`${styleVariable('button.background')}:#0d766e`);
  });

  it('marks blocks for the canvas only in the preview', () => {
    const preview = generator.toHtml(page(), 'preview').html;
    const final = generator.toHtml(page(), 'final').html;
    for (const id of ['s1', 'c1', 'h1', 't1', 'b1', 'i1', 'd1', 'p1', 's2', 'c3', 'f1', 'r1', 'o1'])
      expect(preview).toContain(`${NODE_ATTRIBUTE}="${id}"`);
    for (const id of ['h1', 't1', 'b1', 'o1'])
      expect(preview).toContain(`${EDIT_NODE_ATTRIBUTE}="${id}"`);
    expect(preview).not.toContain(`${EDIT_NODE_ATTRIBUTE}="i1"`);
    expect(final).not.toContain('data-visual-editor');
    expect(preview.replace(/ data-visual-editor-[a-z-]+="[^"]*"/g, '')).toBe(final);
  });

  it('keeps an image without address as a placeholder only in the preview', () => {
    const document = simple([{ id: 'i1', type: 'image', props: {} }], 'page');
    expect(generator.toHtml(document, 'final').html).not.toContain('ve-b-i1');
    expect(generator.toHtml(document, 'preview').html).toContain('ve-image-empty ve-b-i1');
  });

  it('produces a page the codec imports, scripts reported as preserved', () => {
    const output = generator.toHtml(page(), 'final');
    const imported = new HtmlDocumentCodec(new ContentPolicy()).import(output, 'page');
    expect(imported.document).toBeDefined();
    expect(imported.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(imported.diagnostics.map((item) => item.code)).toContain('SCRIPT_PRESERVED');
  });

  it('only generates pages', () => {
    expect(() => generator.toHtml(simple([]), 'final')).toThrow('BLOCK_GENERATOR_KIND_MISMATCH');
  });
});

describe('page classes', () => {
  it('keeps block classes apart from the structural ones whatever the id', () => {
    const ids = ['page', 'section', 'block', 'columns', 'column', 'button', 'heading', 'text'];
    const document = documentOf(
      [
        section('section', [
          column('columns', [
            { id: 'button', type: 'button', props: { text: 'x', background: '#ff0000' } },
            { id: 'text', type: 'text', props: { text: '<p>x</p>', color: '#00ff00' } },
            { id: 'heading', type: 'heading', props: { text: 'x' } },
            { id: 'image-empty', type: 'image', props: {} },
            { id: 'html', type: 'html', props: { html: '<p>x</p>' } },
            { id: 'footer', type: 'footer', props: { text: '<p>x</p>' } },
          ]),
        ]),
        section('page', [column('block', []), column('column', [])]),
      ],
      'page',
    );
    const { html, css } = generator.toHtml(document, 'preview');
    for (const id of ids) expect(html).toContain(`ve-b-${id}`);
    expect(css).toContain('.ve-b-button .ve-button{background-color:#ff0000}');
    expect(css).toContain('.ve-b-text{color:#00ff00}');
    expect(css).toContain('.ve-b-page > .ve-columns{');
    // No rule of a block lands on a structural class.
    expect(css).not.toContain('#ff0000}.ve-button');
    expect(css).not.toMatch(
      /(^|\})\.ve-(button|text|page|section|columns|column|block|heading)\{[^}]*#(ff0000|00ff00)/,
    );
    expect(css).not.toContain('.ve-page > .ve-columns');
    expect(html).not.toContain('ve-image-empty ve-image-empty');
  });

  it('keeps author markup unchanged between preview and published page', () => {
    const document = simple(
      [
        {
          id: 'r1',
          type: 'html',
          props: { html: '<div class="hero" id="x"><svg><g></g></svg></div>' },
        },
        { id: 't1', type: 'text', props: { text: '<p><span style="color:#ff0000">x</span></p>' } },
      ],
      'page',
    );
    const preview = generator.toHtml(document, 'preview').html;
    const final = generator.toHtml(document, 'final').html;
    expect(preview.replace(/ data-visual-editor-[a-z-]+="[^"]*"/g, '')).toBe(final);
    expect(preview.match(/data-visual-editor-node="r1"/g)).toHaveLength(1);
  });
});
