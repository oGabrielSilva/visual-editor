import { describe, expect, it } from 'vitest';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { EditorFactory } from '../../../src/composition/factory';
import { EditorDocument } from '../../../src/core/document';
import type { Diagnostic, DocumentNode } from '../../../src/core/document';
import { ContentPolicy } from '../../../src/security/policy';
import { EMAIL_HANDMADE, EMAIL_MAILCHIMP, EMAIL_MJML, LANDING_PAGE } from '../fixtures/real-world';

const factory = new EditorFactory(() => ({
  async compile() {
    return '<p>Template</p>';
  },
}));

const all = (nodes: readonly DocumentNode[]): DocumentNode[] =>
  nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
const textOf = (node: DocumentNode): string =>
  node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(textOf).join('');
const errors = (diagnostics: readonly Diagnostic[]): readonly Diagnostic[] =>
  diagnostics.filter((item) => item.severity === 'error');
const summary = (diagnostics: readonly Diagnostic[]): readonly string[] =>
  diagnostics.map((item) => `${item.severity}:${item.code}:${item.count ?? 1}`);
/** Whole blocks of the source which have to be found again exactly as they were written. */
const blocks = (source: string, pattern: RegExp): readonly string[] => {
  const found = source.match(pattern) ?? [];
  expect(found.length).toBeGreaterThan(0);
  return found;
};

describe('a landing page built with Bootstrap, jQuery and marketing tags', () => {
  const page = { html: LANDING_PAGE, css: '' };

  it('is imported without any refusal and described by grouped notices', () => {
    const imported = new HtmlDocumentCodec().import(page, 'page');
    expect(errors(imported.diagnostics)).toEqual([]);
    expect(imported.document).toBeDefined();
    expect(summary(imported.diagnostics)).toEqual([
      'info:SCRIPT_PRESERVED:5',
      'info:EMBED_PRESERVED:2',
      'info:INLINE_HANDLER_PRESERVED:2',
      'info:EXTERNAL_STYLE_PRESERVED:3',
      'info:FORM_PRESERVED:1',
    ]);
    for (const diagnostic of imported.diagnostics) {
      expect(diagnostic.messageKey).toBe(`diagnostics.${diagnostic.code}`);
      // Every notice of a page points at the first node it is about.
      expect(
        all(imported.document?.nodes ?? []).some((node) => node.id === diagnostic.nodeId),
      ).toBe(true);
    }
  });

  it('is written back byte for byte when nothing was edited', () => {
    const codec = new HtmlDocumentCodec();
    const imported = codec.import(page, 'page');
    if (!imported.document) throw new Error('Refused');
    expect(codec.export(imported.document)).toEqual(page);
  });

  it('keeps everything when it is reopened from JSON without the source', () => {
    const policy = new ContentPolicy();
    const imported = new HtmlDocumentCodec(policy).import(page, 'page');
    if (!imported.document) throw new Error('Refused');
    const portable: unknown = JSON.parse(JSON.stringify(imported.document));
    const fresh = new HtmlDocumentCodec(policy);
    const reopened = EditorDocument.from(portable).snapshot();
    expect(() => policy.assertSafe(reopened)).not.toThrow();
    const written = fresh.export(reopened).html;
    for (const block of [
      ...blocks(LANDING_PAGE, /<script[\s\S]*?<\/script>/g),
      ...blocks(LANDING_PAGE, /<noscript>[\s\S]*?<\/noscript>/g),
      ...blocks(LANDING_PAGE, /<svg[\s\S]*?<\/svg>/g),
      ...blocks(LANDING_PAGE, /<template[\s\S]*?<\/template>/g),
      ...blocks(LANDING_PAGE, /<style>[\s\S]*?<\/style>/g),
    ])
      expect(written, block).toContain(block);
    for (const fragment of [
      '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&amp;display=swap" rel="stylesheet">',
      'href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"',
      '<link rel="icon" href="//cdn.example.com/favicon.ico">',
      '<base target="_blank">',
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Apresentação" allowfullscreen=""></iframe>',
      'action="https://forms.example.com/submit"',
      'srcset="https://cdn.example.com/a-480.webp 480w, https://cdn.example.com/a-960.webp 960w"',
      'href="javascript:void(0)"',
      `onclick="document.getElementById('lead').scrollIntoView()"`,
      'href="tel:+5511999999999"',
      'href="whatsapp://send?phone=5511999999999"',
    ])
      expect(written, fragment).toContain(fragment);
    // The same tree again: what was written is a fixed point of import and export.
    const again = fresh.import({ html: written, css: '' }, 'page');
    if (!again.document) throw new Error('Refused');
    expect(fresh.export(again.document).html).toBe(written);
    expect(JSON.stringify(policy.inspect(again.document))).toBe(
      JSON.stringify(policy.inspect(imported.document)),
    );
  });

  it('keeps scripts, embeds and styles intact when a text elsewhere is edited', () => {
    const { session } = factory.create({ kind: 'page', source: page });
    expect(session.exportSource()).toEqual(page);
    const paragraph = all(session.snapshot().nodes).find((node) => node.attrs?.id === 'rodape');
    if (!paragraph) throw new Error('Missing fixture paragraph');
    expect(session.updateText(paragraph.id, 'Fale com o time comercial.')).toBe(true);
    const edited = session.exportSource().html;
    expect(edited).toContain('<p id="rodape">Fale com o time comercial.</p>');
    expect(edited).not.toContain('Dúvidas? Fale com a gente.');
    for (const block of [
      ...blocks(LANDING_PAGE, /<script[\s\S]*?<\/script>/g),
      ...blocks(LANDING_PAGE, /<noscript>[\s\S]*?<\/noscript>/g),
      ...blocks(LANDING_PAGE, /<svg[\s\S]*?<\/svg>/g),
      ...blocks(LANDING_PAGE, /<template[\s\S]*?<\/template>/g),
      ...blocks(LANDING_PAGE, /<head>[\s\S]*?<\/head>/g),
      ...blocks(LANDING_PAGE, /<header[\s\S]*?<\/header>/g),
      ...blocks(LANDING_PAGE, /<form[\s\S]*?<\/form>/g),
      ...blocks(LANDING_PAGE, /<picture>[\s\S]*?<\/picture>/g),
    ])
      expect(edited, block.slice(0, 60)).toContain(block);
    expect(session.getState().diagnostics.map((item) => item.code)).toEqual([
      'SCRIPT_PRESERVED',
      'EMBED_PRESERVED',
      'INLINE_HANDLER_PRESERVED',
      'EXTERNAL_STYLE_PRESERVED',
      'FORM_PRESERVED',
    ]);
    expect(session.undo()).toBe(true);
    expect(session.exportSource().html).toContain('Dúvidas? Fale com a gente.');
    session.dispose();
  });

  it('accepts the same page pasted into the HTML mode of an open editor', () => {
    const { session } = factory.create({ kind: 'page' });
    session.setMode('html');
    session.setDraftSource(page);
    expect(session.commitDraft()).toBe(true);
    expect(session.exportSource()).toEqual(page);
    expect(errors(session.getState().diagnostics)).toEqual([]);
    session.dispose();
  });
});

describe('e-mails exported by other tools', () => {
  it('imports a Mailchimp style export untouched, merge tags and mc:edit included', () => {
    const codec = new HtmlDocumentCodec();
    const imported = codec.import({ html: EMAIL_MAILCHIMP, css: '' }, 'email');
    expect(imported.diagnostics).toEqual([]);
    if (!imported.document) throw new Error('Refused');
    expect(codec.export(imported.document).html).toBe(EMAIL_MAILCHIMP);
    expect(imported.document.title).toBe('*|MC:SUBJECT|*');
    const editable = all(imported.document.nodes).find(
      (node) => node.attrs?.['mc:edit'] === 'body',
    );
    expect(editable?.attrs?.['mc:repeatable']).toBe('bloco');
    const hrefs = all(imported.document.nodes).flatMap((node) =>
      node.tag === 'a' ? [node.attrs?.href] : [],
    );
    expect(hrefs).toEqual([
      '*|ARCHIVE|*',
      'https://example.com/renovar?email=*|EMAIL|*&utm_source=mc',
      '*|UNSUB|*',
      '*|UPDATE_PROFILE|*',
      'mailto:*|LIST:EMAIL|*',
    ]);
  });

  it('imports an MJML style export with web fonts and tells that they are external', () => {
    const policy = new ContentPolicy();
    const codec = new HtmlDocumentCodec(policy);
    const imported = codec.import({ html: EMAIL_MJML, css: '' }, 'email');
    expect(summary(imported.diagnostics)).toEqual(['info:EXTERNAL_STYLE_PRESERVED:2']);
    if (!imported.document) throw new Error('Refused');
    expect(codec.export(imported.document).html).toBe(EMAIL_MJML);
    expect(policy.inspect(imported.document).stylesheets).toEqual([
      {
        url: 'https://fonts.googleapis.com/css?family=Roboto:300,400,500,700',
        origin: 'https://fonts.googleapis.com',
      },
      {
        url: 'https://fonts.googleapis.com/css?family=Roboto:300,400,500,700',
        origin: 'https://fonts.googleapis.com',
      },
    ]);
  });

  it('imports a handmade Outlook e-mail, removing only the script and the handlers', () => {
    const policy = new ContentPolicy();
    const codec = new HtmlDocumentCodec(policy);
    const imported = codec.import({ html: EMAIL_HANDMADE, css: '' }, 'email');
    expect(errors(imported.diagnostics)).toEqual([]);
    // One entry per code, with how many: never the same sentence four times.
    expect(summary(imported.diagnostics)).toEqual([
      'warning:CHARSET_NORMALIZED:1',
      'warning:SCRIPT_REMOVED:2',
      'warning:INLINE_HANDLER_REMOVED:3',
      'warning:UNSAFE_URL_REMOVED:1',
      'info:FORM_PRESERVED:1',
    ]);
    expect(new Set(imported.diagnostics.map((item) => item.code)).size).toBe(
      imported.diagnostics.length,
    );
    if (!imported.document) throw new Error('Refused');
    const written = codec.export(imported.document).html;
    for (const removed of ['<script', 'onclick', 'onload', 'javascript:', 'track(', 'y()'])
      expect(written, removed).not.toContain(removed);
    expect(written).toContain(
      '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
    );
    for (const block of [
      ...blocks(EMAIL_HANDMADE, /<!--\[if[\s\S]*?<!\[endif\]-->/g),
      ...blocks(EMAIL_HANDMADE, /<!\[if !mso\]>[\s\S]*?<!\[endif\]>/g),
      ...blocks(EMAIL_HANDMADE, /<style[\s\S]*?<\/style>/g),
      ...blocks(EMAIL_HANDMADE, /<form[\s\S]*?<\/form>/g),
    ])
      expect(written, block.slice(0, 60)).toContain(block);
    for (const fragment of [
      '<?xml version="1.0" encoding="iso-8859-1"?>',
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">',
      'xmlns:v="urn:schemas-microsoft-com:vml"',
      '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"',
      '<w:anchorlock/>',
      '<v:fill type="tile" src="https://cdn.example.com/fundo.png" color="#f2f2f2"/>',
      "filter:progid:DXImageTransform.Microsoft.AlphaImageLoader(src='https://cdn.example.com/fundo.png', sizingMethod='scale');",
      '*zoom:1; _height:1%; filter:progid:DXImageTransform.Microsoft.gradient(',
      '<p>Olá %%first_name%%, sua oferta chegou.</p>',
      '{% if contact.vip %}<p>Condição especial para clientes VIP.</p>{% endif %}',
      'src="{{logo}}"',
      'srcset="//cdn.example.com/banner.jpg 1x, //cdn.example.com/banner@2x.jpg 2x"',
      '<a href="tel:+551140028922">(11) 4002-8922</a>',
      '<a href="sms:+5511999999999">SMS</a>',
      '<a href="whatsapp://send?phone=5511999999999">WhatsApp</a>',
      '<a href="{{ unsubscribe_url }}">Descadastrar</a>',
      '<a href="mailto:{{contact.email}}">Meu e-mail</a>',
      '<a href="%%unsubscribe%%">Sair</a>',
      '<a href="*|UNSUB|*">Sair da lista</a>',
      '<a>Topo</a>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="5" /></svg>',
    ])
      expect(written, fragment).toContain(fragment);
    // The cleaned message is a fixed point and an e-mail which needs no further removal.
    const again = codec.import({ html: written, css: '' }, 'email');
    expect(summary(again.diagnostics)).toEqual(['info:FORM_PRESERVED:1']);
    if (!again.document) throw new Error('Refused');
    expect(codec.export(again.document).html).toBe(written);
    const inventory = policy.inspect(again.document);
    expect(inventory.scripts).toEqual({ inline: 0, external: [], data: 0 });
    expect(inventory.inlineHandlers + inventory.scriptUrls + inventory.embeds).toBe(0);
    expect(inventory.charsets).toEqual(['utf-8']);
  });

  it.each([
    ['Mailchimp', EMAIL_MAILCHIMP, 'Olá, *|FNAME|*!'],
    ['MJML', EMAIL_MJML, 'Ler no navegador'],
    ['handmade', EMAIL_HANDMADE, 'Versão para os demais clientes'],
  ])('edits a text of the %s e-mail and reopens it from JSON', (_name, html, target) => {
    const editor = factory.create({ kind: 'email', source: { html, css: '' } });
    const initial = editor.session.getState();
    expect(errors(initial.diagnostics)).toEqual([]);
    // What the import removed is reported by the session which was created from the source.
    expect(initial.diagnostics.some((item) => item.code === 'SCRIPT_REMOVED')).toBe(
      html === EMAIL_HANDMADE,
    );
    const node = all(initial.document.nodes).find(
      (candidate) =>
        candidate.type === 'element' &&
        candidate.children?.length === 1 &&
        candidate.children[0]?.type === 'text' &&
        textOf(candidate) === target,
    );
    if (!node) throw new Error('Missing fixture text');
    expect(editor.session.updateText(node.id, 'Texto editado')).toBe(true);
    const edited = editor.session.exportSource().html;
    expect(edited).toContain('Texto editado');
    expect(edited).not.toContain(target);
    for (const block of blocks(html, /<!--\[if[\s\S]*?<!\[endif\]-->/g))
      expect(edited, block.slice(0, 60)).toContain(block);
    const portable: unknown = JSON.parse(JSON.stringify(editor.session.snapshot()));
    const reopened = factory.create({
      kind: 'email',
      document: EditorDocument.from(portable).snapshot(),
    });
    expect(errors(reopened.session.getState().diagnostics)).toEqual([]);
    const written = reopened.session.exportSource().html;
    expect(written).toContain('Texto editado');
    for (const block of blocks(html, /<!--\[if[\s\S]*?<!\[endif\]-->/g))
      expect(written, block.slice(0, 60)).toContain(block);
    editor.dispose();
    reopened.dispose();
  });

  it('cleans an e-mail which arrives as JSON with a script and says so', () => {
    const page = new HtmlDocumentCodec().import(
      { html: '<p onclick="x()">Texto</p><script>x()</script>', css: '' },
      'page',
    ).document;
    if (!page) throw new Error('Refused');
    const forged = { ...page, kind: 'email' as const };
    const editor = factory.create({ document: forged });
    expect(editor.session.exportSource().html).toBe('<p>Texto</p>');
    expect(summary(editor.session.getState().diagnostics)).toEqual([
      'warning:INLINE_HANDLER_REMOVED:1',
      'warning:SCRIPT_REMOVED:1',
    ]);
    const target = factory.create({ kind: 'email', source: { html: '<p>Antes</p>', css: '' } });
    expect(target.session.importJson(forged)).toBe(true);
    expect(target.session.exportSource().html).toBe('<p>Texto</p>');
    expect(target.session.getState().diagnostics.map((item) => item.code)).toEqual([
      'INLINE_HANDLER_REMOVED',
      'SCRIPT_REMOVED',
    ]);
    // A command of the editor still cannot write what the import would have removed.
    const paragraph = all(target.session.snapshot().nodes).find((node) => node.tag === 'p');
    if (!paragraph) throw new Error('Missing paragraph');
    expect(target.session.insertSource({ html: '<p>Bloco</p><script>x()</script>', css: '' })).toBe(
      true,
    );
    expect(target.session.exportSource().html).not.toContain('<script');
    editor.dispose();
    target.dispose();
  });
});

describe('source no parser reads back the same', () => {
  it('settles tag soup into what a browser builds and says the HTML was normalized', () => {
    const codec = new HtmlDocumentCodec();
    // Misnested anchors and tables: the tree a parser builds is not what it reads back from
    // its own output, until that output is read once more.
    const soup = '<a><table><td><a><table></table><a></tr><a></table><b>X</b>C<a>Y';
    const imported = codec.import({ html: soup, css: '' }, 'page');
    expect(imported.diagnostics).toEqual([
      { code: 'HTML_NORMALIZED', severity: 'info', messageKey: 'diagnostics.HTML_NORMALIZED' },
    ]);
    if (!imported.document) throw new Error('Refused');
    const written = codec.export(imported.document).html;
    expect(written).not.toBe(soup);
    for (const text of ['X', 'C', 'Y']) expect(written).toContain(text);
    const again = codec.import({ html: written, css: '' }, 'page');
    expect(again.diagnostics).toEqual([]);
    expect(again.document && codec.export(again.document).html).toBe(written);
    // Without the source the settled tree is written in its own canonical form, which is
    // a fixed point: reading it gives the same tree and no further notice.
    const portable: unknown = JSON.parse(JSON.stringify(imported.document));
    const fresh = new HtmlDocumentCodec();
    const canonical = fresh.export(EditorDocument.from(portable).snapshot()).html;
    const settled = fresh.import({ html: canonical, css: '' }, 'page');
    expect(settled.diagnostics).toEqual([]);
    expect(settled.document && fresh.export(settled.document).html).toBe(canonical);
  });

  it('still refuses, with its own code, the rare markup which never settles', () => {
    // Nothing ends `plaintext`: every pass would swallow one more closing tag as text.
    const imported = new HtmlDocumentCodec().import(
      { html: '<div><plaintext>a</div><p>b</p>', css: '' },
      'page',
    );
    expect(imported.document).toBeUndefined();
    expect(imported.diagnostics).toEqual([
      { code: 'INVALID_HTML', severity: 'error', messageKey: 'diagnostics.INVALID_HTML' },
    ]);
  });

  it('keeps the content of a row or a cell pasted without its table', () => {
    // Formerly INVALID_HTML_CONTENT_MODEL. A browser placing this markup in a body drops
    // the orphan table parts and keeps what they held.
    for (const [html, kept] of [
      ['<td>x</td>', 'x'],
      ['<tr><td>Um <b>dois</b></td><td>três</td></tr>', 'Um <b>dois</b>três'],
      ['<p>a</p><td>b</td>', '<p>a</p>b'],
    ] as const) {
      const imported = new HtmlDocumentCodec().import({ html, css: '' }, 'email');
      expect(imported.diagnostics, html).toEqual([]);
      const portable: unknown = JSON.parse(JSON.stringify(imported.document));
      expect(
        new HtmlDocumentCodec().export(EditorDocument.from(portable).snapshot()).html,
        html,
      ).toBe(kept);
    }
  });

  it('drops the null character instead of refusing the source', () => {
    const codec = new HtmlDocumentCodec();
    const imported = codec.import({ html: '<p>a\u0000b</p>', css: '' }, 'page');
    expect(imported.diagnostics).toEqual([]);
    expect(imported.document && codec.export(imported.document).html).toBe('<p>ab</p>');
  });
});

describe('limits of the tolerant import', () => {
  const codec = new HtmlDocumentCodec();
  const code = (html: string, css = ''): string | undefined =>
    codec.import({ html, css }, 'page').diagnostics.find((item) => item.severity === 'error')?.code;

  it('reports each exceeded limit with its own code', () => {
    // Wide, not deep: this used to be reported as DOCUMENT_TOO_DEEP.
    expect(code('<p></p>'.repeat(60_000))).toBe('DOCUMENT_TOO_MANY_NODES');
    expect(code(`${'<div>'.repeat(300)}x`)).toBe('DOCUMENT_TOO_DEEP');
    expect(code('x'.repeat(2_000_001))).toBe('DOCUMENT_TOO_LARGE');
    expect(code('<p>x</p>', 'a{}'.repeat(200_000))).toBe('CSS_TOO_LARGE');
    expect(code(`<p ${Array.from({ length: 300 }, (_, i) => `a${i}="1"`).join(' ')}>x</p>`)).toBe(
      'TOO_MANY_ATTRIBUTES',
    );
  });

  it('accepts 5,200 paragraphs, which the former ceiling of 10,000 nodes refused', () => {
    const imported = codec.import({ html: '<p>Parágrafo</p>'.repeat(5_200), css: '' }, 'page');
    expect(imported.diagnostics).toEqual([]);
    expect(imported.document?.nodes).toHaveLength(5_200);
  });

  it('does not count the white space between tags against the node ceiling', () => {
    // 40,000 counted nodes and 20,000 indentation texts: inside the ceiling of 50,000.
    const html = '<p>x</p>\n  '.repeat(20_000);
    const imported = codec.import({ html, css: '' }, 'page');
    expect(imported.diagnostics).toEqual([]);
    expect(imported.document?.nodes).toHaveLength(40_000);
    // The same amount of content one level deeper and counted: over the ceiling.
    expect(code('<p><b>x</b></p>'.repeat(20_000))).toBe('DOCUMENT_TOO_MANY_NODES');
  });

  it('accepts nesting deeper than the former ceiling of 80 levels', () => {
    const imported = codec.import(
      { html: `${'<div>'.repeat(200)}fundo${'</div>'.repeat(200)}`, css: '' },
      'email',
    );
    expect(imported.diagnostics).toEqual([]);
    expect(imported.document && codec.export(imported.document).html).toContain('fundo');
  });

  it('accepts an inline image far longer than the former attribute ceiling', () => {
    const image = `data:image/png;base64,${'A'.repeat(120_000)}`;
    const imported = codec.import({ html: `<img src="${image}" alt="">`, css: '' }, 'email');
    expect(imported.diagnostics).toEqual([]);
    expect(imported.document?.nodes[0]?.attrs?.src).toBe(image);
  });

  it('imports, edits and exports an e-mail of 400 KB and a page of 1 MB', () => {
    const row = (index: number): string =>
      `<tr>\n<td align="left" style="font-family:Arial, sans-serif;font-size:14px;line-height:22px;color:#333333;padding:10px 25px;">\n<p style="margin:0 0 10px;">Oferta ${index}: condição válida até o fim do mês para {{ contact.first_name }}.</p>\n<a href="https://example.com/oferta/${index}?utm_source=email" style="color:#0d766e;">Ver oferta ${index}</a>\n</td>\n</tr>\n`;
    let rows = '';
    for (let index = 0; rows.length < 400_000; index++) rows += row(index);
    const email = `<!doctype html><html><head><title>Ofertas</title></head><body><table role="presentation" width="600">${rows}</table></body></html>`;
    const section = (index: number): string =>
      `<section class="py-5" id="s${index}">\n  <div class="container">\n    <h2>Seção ${index}</h2>\n    <p class="lead">${'Texto de apresentação da seção. '.repeat(6)}</p>\n    <a class="btn btn-primary" href="https://example.com/s/${index}">Saiba mais</a>\n  </div>\n</section>\n`;
    let sections = '';
    for (let index = 0; sections.length < 1_000_000; index++) sections += section(index);
    const landing = `<!doctype html><html><head><title>Página</title><script src="https://cdn.example.com/app.js"></script></head><body>${sections}</body></html>`;
    for (const [kind, html] of [
      ['email', email],
      ['page', landing],
    ] as const) {
      const editor = factory.create({ kind, source: { html, css: '' } });
      expect(errors(editor.session.getState().diagnostics)).toEqual([]);
      expect(editor.session.exportSource().html).toBe(html);
      const target = all(editor.session.snapshot().nodes).find(
        (node) => node.tag === (kind === 'email' ? 'a' : 'h2'),
      );
      if (!target) throw new Error('Missing fixture target');
      expect(editor.session.updateText(target.id, 'Editado')).toBe(true);
      const edited = editor.session.exportSource().html;
      expect(edited.length).toBeGreaterThan(html.length - 200);
      expect(edited).toContain('Editado');
      editor.dispose();
    }
  }, 120_000);
});
