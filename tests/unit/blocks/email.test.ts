import { afterAll, describe, expect, it } from 'vitest';
import { parse, serialize } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import type { Block, BlockDocument } from '../../../src/core/block-document';
import { BlockMjmlGenerator } from '../../../src/blocks/email-generator';
import { BlockEmailRenderer } from '../../../src/blocks/email-renderer';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { ContentPolicy } from '../../../src/security/policy';
import { CompilationGuard } from '../../../src/compilation/guard';
import { GeneratedMjml, readCompileRequest } from '../../../src/compilation/generated-mjml';
import { EDIT_NODE_ATTRIBUTE, NODE_ATTRIBUTE } from '../../../src/core/canvas-contract';
import { EmailPreviewMarker } from '../../../src/blocks/email-preview';
import { column, documentOf, nodeCompiler, registry, section, simple } from './support';

const generator = new BlockMjmlGenerator(registry);
const compiler = nodeCompiler();
const renderer = new BlockEmailRenderer(generator, compiler);
const codec = new HtmlDocumentCodec(new ContentPolicy());
afterAll(() => compiler.dispose());

const everyBlock = (): BlockDocument =>
  documentOf([
    section('s1', [
      column('c1', [
        { id: 'h1', type: 'heading', props: { text: 'Olá, <em>Nico</em>', level: 'h1' } },
        {
          id: 't1',
          type: 'text',
          props: { text: '<p>Primeiro <a href="https://x.y/?a=1&amp;b=2">link</a></p>' },
        },
        {
          id: 'i1',
          type: 'image',
          props: { url: 'https://x.y/a.png', alt: 'Foto "x"', href: 'https://x.y' },
        },
        { id: 'b1', type: 'button', props: { text: 'Comprar', href: 'https://x.y/comprar' } },
        { id: 'd1', type: 'divider', props: {} },
        { id: 'p1', type: 'spacer', props: { height: '32px' } },
        {
          id: 'r1',
          type: 'html',
          props: {
            html: '<p>Livre</p>',
            padding: '8px 16px',
          },
        },
        {
          id: 'r2',
          type: 'html',
          props: {
            html: '<div class="hero" style="color:#ff0000"><!--[if mso]><b>Outlook</b><![endif]--><span>Autor &amp; cia</span></div>',
          },
        },
      ]),
    ]),
    section('s2', [column('c2', [{ id: 'f1', type: 'footer', props: { text: '<p>Rodapé</p>' } }])]),
  ]);

function count(html: string, value: string): number {
  return html.split(value).length - 1;
}

/** The e-mail without canvas attributes and Outlook copies of preview classes, reparsed. */
function normalize(html: string): string {
  const tree = parse(html);
  const stack: DefaultTreeAdapterMap['parentNode'][] = [tree];
  while (stack.length) {
    const node = stack.pop();
    if (!node) break;
    for (const child of node.childNodes) {
      if ('data' in child)
        child.data = child.data.replace(/ve-p-[a-f0-9]{32}-[A-Za-z0-9_-]+-outlook/g, '');
      if (!('tagName' in child)) continue;
      child.attrs = child.attrs.filter(
        (attribute) => !attribute.name.startsWith('data-visual-editor-'),
      );
      stack.push(child);
    }
  }
  return serialize(tree);
}

const TEXT =
  '<div style="font-family:Arial, Helvetica, sans-serif;font-size:16px;line-height:1.65;color:#243746">';

describe('block e-mail: MJML', () => {
  it('generates stable MJML with global styles in mj-attributes', () => {
    const mjml = generator.toMjml(everyBlock(), 'final');
    expect(mjml).toBeInstanceOf(GeneratedMjml);
    expect(mjml.source).toMatchSnapshot();
    expect(mjml.fragments).toEqual([
      // The wrapper gives the free HTML back the text style MJML zeroes in a column.
      `<tr><td style="padding:8px 16px">${TEXT}<p>Livre</p></div></td></tr>`,
      `<tr><td style="padding:0">${TEXT}<div class="hero" style="color:#ff0000"><!--[if mso]><b>Outlook</b><![endif]--><span>Autor &amp; cia</span></div></div></td></tr>`,
    ]);
    expect(mjml.source).toContain('<mjml lang="pt-BR">');
    expect(mjml.source).toContain('<mj-button background-color="#0d766e"');
    expect(mjml.source).toContain('<mj-class name="ve-heading"');
    // Inherited values are not repeated on the blocks.
    expect(mjml.source).toContain('<mj-text>');
    expect(mjml.source).not.toContain('css-class');
  });

  it('writes the overrides of a block as attributes of its component', () => {
    const mjml = generator.toMjml(
      simple([
        { id: 't1', type: 'text', props: { text: '<p>x</p>', color: '#112233', align: 'center' } },
        { id: 'b1', type: 'button', props: { text: 'x', background: '#445566', fullWidth: true } },
        { id: 'b2', type: 'button', props: { text: 'y', fullWidth: false } },
      ]),
      'final',
    ).source;
    expect(mjml).toContain('<mj-text color="#112233" align="center"><p>x</p></mj-text>');
    expect(mjml).toContain('<mj-button background-color="#445566" width="100%">x</mj-button>');
    expect(mjml).toContain('<mj-button>y</mj-button>');
  });

  it('only generates e-mails', () => {
    expect(() => generator.toMjml(simple([], 'page'), 'final')).toThrow(
      'BLOCK_GENERATOR_KIND_MISMATCH',
    );
  });
});

describe('block e-mail: compiled HTML', () => {
  it('compiles every block into an e-mail the import accepts as it is', async () => {
    const output = await renderer.render(everyBlock(), 'final');
    const imported = codec.import(output, 'email');
    expect(imported.document).toBeDefined();
    expect(imported.diagnostics.filter((item) => item.severity !== 'info')).toEqual([]);
    expect(output.html).toContain('<html lang="pt-BR"');
    expect(output.html).toContain(
      '<h1 style="margin:0;font-family:Arial, Helvetica, sans-serif;font-size:28px;font-weight:700;line-height:1.25;color:#10302c">Olá, <em>Nico</em></h1>',
    );
    expect(output.html).toContain('href="https://x.y/?a=1&amp;b=2"');
    expect(output.html).toContain('alt="Foto &quot;x&quot;"');
    expect(output.html).toContain(
      `<tr><td style="padding:8px 16px">${TEXT}<p>Livre</p></div></td></tr>`,
    );
    expect(output.html).not.toContain('data-visual-editor');
    expect(output.html).not.toMatch(/\bve-(?!heading|footer)[A-Za-z0-9]/);
  }, 30_000);

  it('changes every point of every button when the global button color changes', async () => {
    const buttons = (): Block[] => [
      { id: 'b1', type: 'button', props: { text: 'Um', href: 'https://x.y/1' } },
      { id: 'b2', type: 'button', props: { text: 'Dois', href: 'https://x.y/2' } },
    ];
    const first = documentOf([section('s1', [column('c1', buttons())])], 'email', {
      styles: { button: { background: '#123456' } },
    });
    const second = first.updateStyles({ button: { background: '#abcdef' } });
    const before = (await renderer.render(first, 'final')).html;
    const after = (await renderer.render(second, 'final')).html;
    for (const html of [before, after]) {
      const color = html === before ? '#123456' : '#abcdef';
      // Each button: `bgcolor` and `background` of the cell, `background` of the link.
      expect(count(html, `bgcolor="${color}"`)).toBe(2);
      expect(count(html, `background:${color};`)).toBe(4);
      expect(count(html, color)).toBe(6);
    }
    expect(after).not.toContain('#123456');
    expect(after.replaceAll('#abcdef', '#123456')).toBe(before);
  }, 30_000);

  it('lets one button keep its own color while the global one changes', async () => {
    const document = simple([
      {
        id: 'b1',
        type: 'button',
        props: { text: 'Um', href: 'https://x.y/1', background: '#ff0000' },
      },
      { id: 'b2', type: 'button', props: { text: 'Dois', href: 'https://x.y/2' } },
    ]).updateStyles({ button: { background: '#00ff00' } });
    const html = (await renderer.render(document, 'final')).html;
    expect(count(html, '#ff0000')).toBe(3);
    expect(count(html, '#00ff00')).toBe(3);
    const restored = (await renderer.render(document.restoreDefault('b1', ['background']), 'final'))
      .html;
    expect(count(restored, '#ff0000')).toBe(0);
    expect(count(restored, '#00ff00')).toBe(6);
  }, 30_000);

  it('makes real columns with their weights and stacks them below the breakpoint', async () => {
    const document = documentOf([
      section('s1', [
        column('c1', [{ id: 't1', type: 'text', props: { text: '<p>a</p>' } }], { weight: 2 }),
        column('c2', [{ id: 't2', type: 'text', props: { text: '<p>b</p>' } }]),
      ]),
      section('s2', [column('c3', []), column('c4', []), column('c5', []), column('c6', [])]),
    ]);
    const mjml = generator.toMjml(document, 'final').source;
    expect(mjml).toContain('<mj-column width="66.67%">');
    expect(mjml).toContain('<mj-column width="33.33%">');
    expect(mjml.match(/<mj-column width="25%">/g)).toHaveLength(4);
    const html = (await renderer.render(document, 'final')).html;
    expect(html).toContain('mj-column-per-66-67');
    expect(html).toContain('mj-column-per-33-33');
    expect(html).toContain('mj-column-per-25');
    expect(html).toContain('@media only screen and (min-width:641px)');
    // Outlook gets a table cell per column instead of CSS.
    expect(html).toMatch(/<td class="" style="vertical-align:top;width:400px;" >/);
  }, 30_000);

  it('marks blocks for the canvas only in the preview', async () => {
    const document = everyBlock();
    const preview = (await renderer.render(document, 'preview')).html;
    const final = (await renderer.render(document, 'final')).html;
    for (const id of ['s1', 'c1', 'h1', 't1', 'i1', 'b1', 'd1', 'p1', 'r1', 's2', 'c2', 'f1'])
      expect(count(preview, `${NODE_ATTRIBUTE}="${id}"`), id).toBe(1);
    expect(preview).toMatch(new RegExp(`<h1 style="[^"]*" ${EDIT_NODE_ATTRIBUTE}="h1">`));
    expect(preview).toMatch(
      new RegExp(`<a href="https://x.y/comprar"[^>]*${EDIT_NODE_ATTRIBUTE}="b1"`),
    );
    expect(preview).toMatch(new RegExp(`<div style="[^"]*" ${EDIT_NODE_ATTRIBUTE}="t1">`));
    expect(preview).toMatch(new RegExp(`<div style="[^"]*" ${EDIT_NODE_ATTRIBUTE}="f1">`));
    expect(final).not.toContain('data-visual-editor');
    expect(final).not.toMatch(/\bve-[pb]-/);
    // The preview classes are taken out again: the preview is the sent e-mail, author content
    // included, plus the canvas attributes. Only the Outlook comments keep a copy of the class.
    expect(normalize(preview)).not.toContain('ve-p-');
    expect(normalize(preview)).toBe(normalize(final));
  }, 30_000);

  it('never gives one block two targets, whatever the author writes', async () => {
    const forged = '<div class="ve-p-00000000000000000000000000000000-t1">x</div>';
    expect(() =>
      simple([
        { id: 't1', type: 'text', props: { text: '<p>x</p>' } },
        { id: 'r1', type: 'html', props: { html: forged } },
      ]),
    ).toThrow('UNSAFE_BLOCK_HTML');
    // Even markup carrying a preview class of another rendering is ignored by the marker.
    const marker = new EmailPreviewMarker();
    const document = simple([{ id: 't1', type: 'text', props: { text: '<p>x</p>' } }]);
    const token = 'a'.repeat(32);
    const html = `<table><tbody><tr><td class="ve-p-${token}-t1"><div>a</div></td></tr><tr><td class="ve-p-${token}-t1"><div>b</div></td></tr><tr><td class="ve-p-${'b'.repeat(32)}-t1">c</td></tr></tbody></table>`;
    const marked = marker.mark(html, document, token);
    expect(count(marked, `${NODE_ATTRIBUTE}="t1"`)).toBe(1);
    expect(count(marked, `${EDIT_NODE_ATTRIBUTE}="t1"`)).toBe(1);
    expect(marked).not.toContain(`ve-p-${token}`);
    expect(marked).toContain(`ve-p-${'b'.repeat(32)}-t1`);
  });

  it('draws a new preview token for every rendering', () => {
    const document = simple([{ id: 't1', type: 'text', props: { text: '<p>x</p>' } }]);
    const one = generator.toMjml(document, 'preview').source;
    const two = generator.toMjml(document, 'preview').source;
    expect(one).toMatch(/css-class="ve-p-[a-f0-9]{32}-t1"/);
    expect(one).not.toBe(two);
    expect(() => generator.toMjml(document, 'preview', 'x')).toThrow('INVALID_PREVIEW_TOKEN');
  });

  it('shows an image without address only as a placeholder in the preview', async () => {
    const document = simple([{ id: 'i1', type: 'image', props: { alt: 'x' } }]);
    expect(generator.toMjml(document, 'final').source).not.toContain('mj-image');
    expect(generator.toMjml(document, 'preview', 'c'.repeat(32)).source).toContain(
      `<mj-spacer height="120px" container-background-color="#e8eef0" css-class="ve-p-${'c'.repeat(32)}-i1"></mj-spacer>`,
    );
    expect((await renderer.render(document, 'preview')).html).toContain(`${NODE_ATTRIBUTE}="i1"`);
  }, 30_000);
});

describe('block e-mail: mj-raw only through the codec', () => {
  const guard = new CompilationGuard();
  const raw = '<tr><td style="padding:0"><p>x</p></td></tr>';
  const previewRaw = `<tr><td class="ve-p-${'d'.repeat(32)}-r1" style="padding:0">x</td></tr>`;
  const source = (content: string) =>
    `<mjml><mj-body><mj-section><mj-column><mj-raw>${content}</mj-raw></mj-column></mj-section></mj-body></mjml>`;

  it('refuses mj-raw in MJML from outside, even with clean content', async () => {
    expect(() => guard.source(source(raw))).toThrow('COMPILE_FORBIDDEN_TAG');
    await expect(compiler.compile(source(raw))).rejects.toThrow('COMPILE_FORBIDDEN_TAG');
  });

  it('accepts the raw regions the codec generated and compiles them', async () => {
    expect(() => guard.source(source(raw), [raw])).not.toThrow();
    const html = await compiler.compileGenerated(new GeneratedMjml(source(raw), [raw]));
    expect(html).toContain(raw);
  }, 30_000);

  it('refuses a raw region that is not one of the generated fragments', () => {
    expect(() => guard.source(source('<tr><td><p>y</p></td></tr>'), [raw])).toThrow(
      'COMPILE_FORBIDDEN_TAG',
    );
    const outside = `<mjml><mj-body><mj-raw>${raw}</mj-raw></mj-body></mjml>`;
    expect(() => guard.source(outside, [raw])).toThrow('COMPILE_FORBIDDEN_TAG');
  });

  it('checks every fragment as a browser reads it inside the column table', () => {
    expect(() => guard.source(source(previewRaw), [previewRaw])).not.toThrow();
    for (const fragment of [
      '<tr><td><script>x()</script></td></tr>',
      '<tr><td><p onclick="x()">x</p></td></tr>',
      '<tr><td><a href="javascript:x()">x</a></td></tr>',
      '<tr><td><iframe src="https://x.y"></iframe></td></tr>',
      '<tr><td><base href="https://x.y/"></td></tr>',
      '<tr><td>a</td></tr><tr><td>b</td></tr>',
      '<tr><td>a</td><td>b</td></tr>',
      '<tr><td onclick="x()">a</td></tr>',
      '<tr><td style="background:url(javascript:x)">a</td></tr>',
      '<tr><td class="ve-r1">a</td></tr>',
      '<tr class="x"><td>a</td></tr>',
      '<p>outside a row</p>',
      '<tr><td title="</mj-raw><mj-include path=x />">a</td></tr>',
      '<tr><td><mj-text>x</mj-text></td></tr>',
    ])
      expect(() => guard.source(source(fragment), [fragment]), fragment).toThrow(
        'COMPILE_UNSAFE_RAW',
      );
  });

  it('only accepts generated MJML as the generated type', async () => {
    await expect(
      compiler.compileGenerated({ source: source(raw), fragments: [raw] } as GeneratedMjml),
    ).rejects.toThrow('INVALID_COMPILE_INPUT');
    expect(readCompileRequest('x')).toEqual({ source: 'x' });
    expect(readCompileRequest({ source: 'x', fragments: [raw] })).toEqual({
      source: 'x',
      fragments: [raw],
    });
    expect(readCompileRequest({ source: 'x', fragments: [1] })).toBeUndefined();
    expect(readCompileRequest(null)).toBeUndefined();
  });

  it('never lets an unsafe free HTML block reach the MJML', () => {
    expect(() =>
      simple([{ id: 'r1', type: 'html', props: { html: '<p>x</p><script>x()</script>' } }]),
    ).toThrow('UNSAFE_BLOCK_HTML');
  });
});
