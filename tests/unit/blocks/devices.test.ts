import { afterAll, describe, expect, it } from 'vitest';
import { BlockDocument } from '../../../src/core/block-document';
import { BlockMjmlGenerator } from '../../../src/blocks/email-generator';
import { BlockEmailRenderer } from '../../../src/blocks/email-renderer';
import { BlockPageGenerator } from '../../../src/blocks/page-generator';
import { BlockInspector } from '../../../src/blocks/block-inspector';
import { BlockChecker, GMAIL_CLIP_BYTES } from '../../../src/blocks/block-checks';
import { column, data, documentOf, nodeCompiler, registry, section, simple } from './support';

const generator = new BlockMjmlGenerator(registry);
const pages = new BlockPageGenerator(registry);
const TOKEN = 'a'.repeat(32);
const compiler = nodeCompiler();
const renderer = new BlockEmailRenderer(generator, compiler);
afterAll(() => compiler.dispose());

const text = (props = {}, mobile?: Record<string, string>) => ({
  id: 't1',
  type: 'text' as const,
  props: { text: '<p>Olá</p>', ...props },
  ...(mobile ? { mobile } : {}),
});

describe('mobile values of a block', () => {
  it('sets, keeps apart and restores a mobile value of a responsive field', () => {
    const start = simple([text({ fontSize: '16px' })]);
    const mobile = start.updateProps('t1', { fontSize: '22px' }, 'mobile');
    expect(mobile.find('t1')).toMatchObject({
      props: { fontSize: '16px' },
      mobile: { fontSize: '22px' },
    });
    expect(mobile.revision).toBe(start.revision + 1);
    const restored = mobile.restoreDefault('t1', ['fontSize'], 'mobile');
    expect(restored.find('t1')?.mobile).toBeUndefined();
    expect(restored.find('t1')?.props.fontSize).toBe('16px');
    expect(restored.restoreDefault('t1', ['fontSize'], 'mobile')).toBe(restored);
  });

  it('refuses mobile values of fields that apply to every screen', () => {
    const start = simple([text()]);
    expect(() => start.updateProps('t1', { color: '#ff0000' }, 'mobile')).toThrow(
      'BLOCK_PROP_NOT_RESPONSIVE',
    );
    expect(() =>
      documentOf([section('s1', [column('c1', [text({}, { color: '#ff0000' })])])]),
    ).toThrow('BLOCK_PROP_NOT_RESPONSIVE');
  });

  it('refuses an empty, unknown or invalid set of mobile values', () => {
    expect(() => documentOf([section('s1', [column('c1', [text({}, {})])])])).toThrow(
      'INVALID_BLOCK_PROPS',
    );
    expect(() =>
      documentOf([section('s1', [column('c1', [text({}, { fontSize: 'enorme' })])])]),
    ).toThrow();
    // A button aligns by the cell MJML writes: no mobile alignment in an e-mail, one in a page.
    const button = {
      id: 'b1',
      type: 'button' as const,
      props: { text: 'Ir', href: 'https://x.y' },
    };
    expect(() =>
      documentOf([section('s1', [column('c1', [{ ...button, mobile: { align: 'left' } }])])]),
    ).toThrow('BLOCK_PROP_NOT_RESPONSIVE');
    expect(
      documentOf(
        [section('s1', [column('c1', [{ ...button, mobile: { align: 'left' } }])])],
        'page',
      ).find('b1')?.mobile,
    ).toEqual({ align: 'left' });
  });

  it('copies the mobile values with the block', () => {
    let next = 0;
    const copy = simple([text({}, { fontSize: '22px' })]).duplicate('t1', () => `x${++next}`);
    expect(copy.find('x1')?.mobile).toEqual({ fontSize: '22px' });
  });

  it('shows the mobile value in the panel of the small screen', () => {
    const document = simple([text({ fontSize: '16px' }, { padding: '4px 8px' })]).snapshot();
    const inspector = new BlockInspector(registry);
    const desktop = inspector.fields(document, 't1', 'desktop');
    const mobile = inspector.fields(document, 't1', 'mobile');
    expect(desktop.find((field) => field.key === 'padding')).toMatchObject({
      own: undefined,
      mobileOverride: true,
      device: 'desktop',
    });
    expect(mobile.find((field) => field.key === 'padding')).toMatchObject({
      own: '4px 8px',
      device: 'mobile',
    });
    expect(mobile.find((field) => field.key === 'fontSize')).toMatchObject({
      own: undefined,
      effective: '16px',
      device: 'mobile',
    });
    // The color applies to every screen: shown as such even on the small one.
    expect(mobile.find((field) => field.key === 'color')).toMatchObject({ device: 'desktop' });
  });
});

describe('device rules of an e-mail', () => {
  const piece = (): BlockDocument =>
    documentOf([
      section(
        's1',
        [
          column('c1', [text({ hideOnDesktop: true }, { fontSize: '22px', padding: '4px' })]),
          column('c2', [{ id: 'h2', type: 'heading', props: { text: 'T', hideOnMobile: true } }]),
        ],
        { stackReverse: true },
      ),
    ]);

  it('writes the mobile values as a small-screen rule of the cell', () => {
    const { source } = generator.toMjml(piece(), 'final', TOKEN);
    expect(source).toContain('css-class="ve-hide-d ve-m-t1"');
    expect(source).toContain('css-class="ve-hide-m"');
    expect(source).toContain(
      '@media only screen and (max-width:640px){.ve-hide-m{display:none!important;mso-hide:all!important}',
    );
    expect(source).toContain('.ve-m-t1>div{font-size:22px!important}');
    expect(source).toContain('.ve-m-t1{padding:4px!important}');
    expect(source).toContain(
      '<mj-style inline="inline">.ve-hide-d{display:none;mso-hide:all;max-height:0;overflow:hidden}</mj-style>',
    );
  });

  it('fades the hidden blocks in the editing frame instead of hiding them', () => {
    const { source } = generator.toMjml(piece(), 'preview', TOKEN);
    expect(source).not.toContain('inline="inline"');
    expect(source).toContain('@media only screen and (min-width:641px){.ve-hide-d{opacity:.35');
    expect(source).toContain(`css-class="ve-p-${TOKEN}-t1 ve-hide-d ve-m-t1"`);
  });

  it('writes nothing about devices for a piece without device values', () => {
    const { source } = generator.toMjml(simple([text()]), 'final', TOKEN);
    expect(source).not.toContain('ve-hide');
    expect(source).not.toContain('max-width:640px');
  });

  it('inlines the desktop hiding and reverses the stacking in the compiled e-mail', async () => {
    const { html } = await renderer.render(piece(), 'final');
    expect(html).toMatch(/class="[^"]*ve-hide-d[^"]*"[^>]*style="[^"]*display: ?none/);
    expect(html).toContain('direction:rtl');
    // Reversed: the second column comes first in the markup, the large screen shows it last.
    expect(html.indexOf('ve-hide-m')).toBeLessThan(html.indexOf('ve-m-t1'));
    expect(html).toContain('.ve-m-t1>div{font-size:22px!important}');
  });
});

describe('device rules of a page', () => {
  const piece = (): BlockDocument =>
    documentOf(
      [
        section(
          's1',
          [
            column('c1', [text({ hideOnMobile: true }, { fontSize: '22px' })]),
            column('c2', [
              {
                id: 'b1',
                type: 'button',
                props: { text: 'Ir', href: 'https://x.y' },
                mobile: { fontSize: '18px', align: 'left' },
              },
            ]),
          ],
          { stackReverse: true, hideOnDesktop: true },
        ),
      ],
      'page',
    );

  it('writes classes, mobile values and visibility in the CSS of the page', () => {
    const { html, css } = pages.toHtml(piece(), 'final');
    expect(html).toContain('class="ve-section ve-b-s1 ve-hide-d"');
    expect(html).toContain('class="ve-block ve-text ve-b-t1 ve-hide-m"');
    expect(css).toContain('@media (min-width:641px){.ve-hide-d{display:none!important}}');
    expect(css).toMatch(
      /@media \(max-width:640px\)\{[^@]*\.ve-b-t1\{font-size:22px\}[^@]*\.ve-b-b1\{text-align:left\}\.ve-b-b1 \.ve-button\{font-size:18px\}[^@]*\.ve-hide-m\{display:none!important\}\}$/,
    );
    expect(css).toContain('.ve-b-s1 > .ve-columns{display:flex;flex-direction:column-reverse}');
  });

  it('fades the hidden blocks in the editing frame', () => {
    const { css } = pages.toHtml(piece(), 'preview');
    expect(css).not.toContain('display:none!important');
    expect(css).toContain('.ve-hide-d{opacity:.35');
  });
});

describe('review before sending', () => {
  const checker = new BlockChecker();

  it('points out links, buttons, images and hidden blocks', () => {
    const document = documentOf([
      section('s1', [
        column('c1', [
          text({ text: '<p>Veja <a href="#">aqui</a></p>' }),
          { id: 'b1', type: 'button', props: { text: '' } },
          { id: 'i1', type: 'image', props: {} },
          { id: 'i2', type: 'image', props: { url: 'https://x.y/a.png' } },
          { id: 'i3', type: 'image', props: { url: 'https://x.y/b.png', alt: 'Foto' } },
          {
            id: 'h1',
            type: 'heading',
            props: { text: 'T', hideOnDesktop: true, hideOnMobile: true },
          },
        ]),
      ]),
    ]);
    expect(checker.check(document).map((check) => [check.code, check.blockId])).toEqual([
      ['LINK_EMPTY', 't1'],
      ['BUTTON_WITHOUT_TEXT', 'b1'],
      ['BUTTON_WITHOUT_LINK', 'b1'],
      ['IMAGE_WITHOUT_SOURCE', 'i1'],
      ['IMAGE_WITHOUT_ALT', 'i2'],
      ['HIDDEN_ON_EVERY_SCREEN', 'h1'],
    ]);
  });

  it('measures the final e-mail against the cut of Gmail', () => {
    const document = simple([text()]);
    expect(checker.check(document, 'x'.repeat(1_000))).toEqual([]);
    expect(checker.check(document, 'x'.repeat(95 * 1024))).toEqual([
      { code: 'EMAIL_NEAR_CLIP', severity: 'warning', kilobytes: 95 },
    ]);
    expect(checker.check(document, 'x'.repeat(GMAIL_CLIP_BYTES + 1))[0]).toMatchObject({
      code: 'EMAIL_CLIPPED',
      severity: 'error',
    });
    expect(checker.check(BlockDocument.from(data([]), registry))).toEqual([
      { code: 'PIECE_EMPTY', severity: 'warning' },
    ]);
  });
});
