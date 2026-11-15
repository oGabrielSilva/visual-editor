import { describe, expect, it } from 'vitest';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { CssDocumentCodec } from '../../../src/codecs/css';
import { ContentPolicy } from '../../../src/security/policy';
import { ActiveMarkupRules } from '../../../src/security/markup-rules';

const email = (html: string, css = '') => {
  const policy = new ContentPolicy();
  const codec = new HtmlDocumentCodec(policy);
  const imported = codec.import({ html, css }, 'email');
  if (!imported.document) throw new Error(`Refused: ${imported.diagnostics[0]?.code}`);
  const exported = codec.export(imported.document);
  return {
    html: exported.html,
    css: exported.css,
    codes: Object.fromEntries(imported.diagnostics.map((entry) => [entry.code, entry.count ?? 1])),
    errors: policy.validate(imported.document).filter((entry) => entry.severity === 'error'),
    inventory: policy.inspect(imported.document),
  };
};
const page = (html: string, css = '') => {
  const codec = new HtmlDocumentCodec();
  const imported = codec.import({ html, css }, 'page');
  if (!imported.document) throw new Error('Refused');
  return codec.export(imported.document);
};

describe('CSS which would run code leaves an e-mail, declaration by declaration', () => {
  it('removes the declaration from a style attribute and keeps the rest of it', () => {
    const result = email(
      '<p style="color:red;width:expression(alert(1));margin:0">a</p><p style="background:url(javascript:alert(1))">b</p><p style="behavior:url(https://x.invalid/a.htc);-moz-binding:url(https://x.invalid/b.xml#x)">c</p><p style="background:url(https://example.test/a.png)">d</p>',
    );
    expect(result.html).toBe(
      '<p style="color:red;margin:0">a</p><p>b</p><p>c</p><p style="background:url(https://example.test/a.png)">d</p>',
    );
    expect(result.codes).toEqual({ ACTIVE_STYLE_REMOVED: 4 });
    expect(result.errors).toEqual([]);
    expect(result.inventory.activeCss).toBe(0);
  });

  it('removes it from style elements, from the panel CSS and from an import of code', () => {
    const sheet =
      '@import url("javascript:alert(1)");@import "https://fonts.example/a.css";p{color:red;width:expression(alert(1))}a{background:url("j\\61vascript:alert(1)");color:blue}';
    const result = email(`<style>${sheet}</style><p>x</p>`, sheet);
    const clean = '@import "https://fonts.example/a.css";p{color:red;}a{color:blue}';
    expect(result.html).toBe(`<style>${clean}</style><p>x</p>`);
    expect(result.css).toBe(clean);
    expect(result.codes.ACTIVE_STYLE_REMOVED).toBe(6);
    expect(result.errors).toEqual([]);
    expect(result.inventory.activeCss).toBe(0);
  });

  it('keeps the built-in behavior which draws the VML of Outlook', () => {
    const vml =
      '<style>v\\:* {behavior:url(#default#VML);} o\\:* {behavior:url(#default#VML);}</style><!--[if mso]><style>v\\:rect{behavior:url(#default#VML)}</style><v:rect style="width:10px"></v:rect><![endif]--><p>x</p>';
    const result = email(vml);
    expect(result.html).toBe(vml);
    expect(result.codes.ACTIVE_STYLE_REMOVED).toBeUndefined();
  });

  it('cuts it out of source kept as text without touching the rest of the block', () => {
    const result = email(
      '<p>x</p><!--[if mso]><table><tr><td style="width:expression(1)">a</td><td style="color:red">b</td></tr></table><style>p{behavior:url(https://x.invalid/a.htc)}</style><![endif]-->',
    );
    expect(result.html).toBe(
      '<p>x</p><!--[if mso]><table><tr><td >a</td><td style="color:red">b</td></tr></table><![endif]-->',
    );
    expect(result.codes.ACTIVE_STYLE_REMOVED).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it('leaves the same CSS in a page, which is only told about it', () => {
    const html = '<p style="width:expression(alert(1))">a</p>';
    expect(page(html, 'p{behavior:url(a.htc)}')).toEqual({ html, css: 'p{behavior:url(a.htc)}' });
  });

  it('reads back as clean whatever it writes', () => {
    const css = new CssDocumentCodec();
    for (const source of [
      'p{width:expression(alert(1))',
      'p{color:red;width:e\\78pression(alert(1));margin:0}',
      'p{background:image-set("javascript:alert(1)" 1x)}',
      '/* c */ p { -moz-binding : url(x.xml#a) ; color : red }',
    ]) {
      const stripped = css.stripActive(source);
      expect(stripped.removed, source).toBeGreaterThan(0);
      expect(css.survey(stripped.css).active, source).toBe(0);
    }
    expect(css.stripActive('p{color:red}')).toEqual({ css: 'p{color:red}', removed: 0 });
  });
});

describe('elements which are only active by what their attributes say together', () => {
  it('removes an animation which writes a code address into a link', () => {
    const result = email(
      '<p>x</p><svg><a href="https://example.test/"><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="xlink:href" values="#a;javascript:alert(1)"/><animate attributeName="opacity" values="0;1"/><text>t</text></a></svg>',
    );
    expect(result.html).toBe(
      '<p>x</p><svg><a href="https://example.test/"><animate attributeName="opacity" values="0;1"/><text>t</text></a></svg>',
    );
    expect(result.codes).toEqual({ UNSAFE_URL_REMOVED: 2 });
    expect(result.errors).toEqual([]);
  });

  it('removes every refresh, to a code address or not', () => {
    const result = email(
      '<html><head><meta http-equiv="refresh" content="0;url=javascript:alert(1)"><meta http-equiv="Refresh" content="0; URL=\'data:text/html,x\'"><meta http-equiv="refresh" content="5;url=https://example.test/"></head><body><p>x</p></body></html>',
    );
    expect(result.html).toBe('<html><head></head><body><p>x</p></body></html>');
    expect(result.codes).toEqual({ UNSAFE_URL_REMOVED: 3 });
  });

  it('removes a portal, a fenced frame and an HTML import with their content', () => {
    const result = email(
      '<p>x</p><portal src="https://example.test/"></portal><fencedframe src="https://example.test/"></fencedframe><link rel="stylesheet import" href="https://example.test/a.html"><link rel="stylesheet" href="https://example.test/a.css">',
    );
    expect(result.html).toBe('<p>x</p><link rel="stylesheet" href="https://example.test/a.css">');
    expect(result.codes.EMBED_REMOVED).toBe(3);
    expect(result.errors).toEqual([]);
  });

  it('counts in a page what it removes from an e-mail', () => {
    const policy = new ContentPolicy();
    const codec = new HtmlDocumentCodec(policy);
    const imported = codec.import(
      {
        html: '<meta http-equiv="refresh" content="0;url=javascript:alert(1)"><svg><a><set attributeName="href" to="javascript:alert(1)"/></a></svg><portal src="x"></portal>',
        css: '',
      },
      'page',
    );
    if (!imported.document) throw new Error('Refused');
    const inventory = policy.inspect(imported.document);
    expect(inventory.scriptUrls).toBe(2);
    expect(inventory.embeds).toBe(1);
  });
});

describe('handlers are the events which exist, not everything which starts with on', () => {
  const rules = new ActiveMarkupRules();

  it('keeps attributes of the author which only look like a handler', () => {
    const result = email(
      '<p onboarding="passo-1" online-status="x" once="true" onclick="a()" ONMOUSEOVER="b()" onpointerrawupdate="c()" onbegin="d()">x</p>',
    );
    expect(result.html).toBe('<p onboarding="passo-1" online-status="x" once="true">x</p>');
    expect(result.codes).toEqual({ INLINE_HANDLER_REMOVED: 4 });
  });

  it('knows the handlers of HTML, SVG animation and the old engines', () => {
    for (const name of [
      'onclick',
      'onerror',
      'onload',
      'onanimationend',
      'onbeforetoggle',
      'onscrollend',
      'onbegin',
      'onrepeat',
      'onreadystatechange',
      'onpropertychange',
      'onwebkittransitionend',
      'onfocusin',
    ])
      expect(rules.attribute(name, 'x'), name).toBe('handler');
    for (const name of ['onboarding', 'on', 'once', 'online-status', 'only', 'onion'])
      expect(rules.attribute(name, 'x'), name).toBeUndefined();
  });

  it('still refuses anything of that shape in what the editor itself writes', () => {
    const policy = new ContentPolicy();
    const node = (attrs: Record<string, string>) => [
      { id: 'a', type: 'element' as const, tag: 'p', attrs },
    ];
    expect(policy.writable(node({ onboarding: 'x' }))).toBe(false);
    expect(policy.writable(node({ onfuture: 'x' }))).toBe(false);
    expect(policy.writable(node({ title: 'x' }))).toBe(true);
  });
});
