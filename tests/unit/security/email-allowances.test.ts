import { describe, expect, it } from 'vitest';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { CssDocumentCodec } from '../../../src/codecs/css';
import { EditorDocument } from '../../../src/core/document';
import { UrlPolicy } from '../../../src/security/url-policy';
import { DownlevelRevealedConditional } from '../../../src/security/conditional-comment';
import { ContentPolicy } from '../../../src/security/policy';

const codes = (html: string): readonly string[] =>
  new HtmlDocumentCodec().import({ html, css: '' }, 'email').diagnostics.map((item) => item.code);

/** Imports as e-mail, requires that nothing was refused and returns what is written back. */
const kept = (html: string): string => {
  const codec = new HtmlDocumentCodec();
  const result = codec.import({ html, css: '' }, 'email');
  expect(
    result.diagnostics.filter((item) => item.severity === 'error'),
    html,
  ).toEqual([]);
  if (!result.document) throw new Error(`Refused: ${html}`);
  return codec.export(result.document).html;
};

const meta = (directive: string, content: string): string =>
  `<!DOCTYPE html><html><head><meta http-equiv="${directive}" content="${content}"></head><body><p>x</p></body></html>`;

describe('meta directives common in e-mail', () => {
  it('accepts spacing and case variants of the UTF-8 content type', () => {
    for (const content of [
      'text/html; charset=utf-8',
      'text/html;charset=UTF-8',
      'TEXT/HTML;  CHARSET=Utf-8',
      ' text/html ; charset = utf-8 ',
    ])
      expect(codes(meta('Content-Type', content)), content).toEqual([]);
  });

  it('accepts the IE rendering hint with and without the Chrome Frame token', () => {
    for (const content of ['IE=edge', 'ie=EDGE', 'IE=edge,chrome=1', 'IE=edge, chrome=1'])
      expect(codes(meta('X-UA-Compatible', content)), content).toEqual([]);
  });

  // An import is never refused for what it contains: a foreign charset is rewritten to
  // UTF-8 with a notice and every other directive is kept as the author wrote it. What a
  // refresh or an author policy could do inside the editor is prevented in the preview copy
  // (tests/unit/security/preview-policy.test.ts), not by turning the document down.
  it('rewrites a foreign charset with a notice and keeps every other directive', () => {
    for (const charset of ['utf-7', 'iso-8859-1', 'utf-16', 'utf-8x', 'windows-1252']) {
      const html = meta('Content-Type', `text/html; charset=${charset}`);
      expect(codes(html), charset).toEqual(['CHARSET_NORMALIZED']);
      expect(kept(html), charset).toContain('content="text/html; charset=utf-8"');
      expect(kept(html), charset).not.toContain(charset);
    }
    for (const [directive, content] of [
      ['Content-Type', 'text/html'],
      ['Content-Type', 'text/html; charset=utf-8; boundary=x'],
      ['Content-Type', 'application/xhtml+xml; charset=utf-8'],
      ['X-UA-Compatible', 'IE=7'],
      ['X-UA-Compatible', 'IE=EmulateIE7'],
      ['X-UA-Compatible', 'IE=edge,chrome=1,requiresActiveX=true'],
      ['Content-Security-Policy', 'script-src *'],
      ['Set-Cookie', 'a=b'],
      ['content-language', 'pt-BR'],
    ] as const) {
      const html = meta(directive, content);
      expect(codes(html), `${directive}: ${content}`).toEqual([]);
      expect(kept(html), `${directive}: ${content}`).toBe(html);
    }
    // A refresh is the exception: it leaves the e-mail with a notice.
    const refresh = meta('refresh', '0;url=https://evil.test');
    expect(codes(refresh)).toEqual(['UNSAFE_URL_REMOVED']);
    expect(kept(refresh)).not.toContain('refresh');
  });
});

describe('declared charset', () => {
  const charset = (value: string): string =>
    `<!DOCTYPE html><html><head><meta charset="${value}"></head><body><p>x</p></body></html>`;

  it('keeps UTF-8 in any case and rewrites any other declaration to UTF-8', () => {
    for (const value of ['utf-8', 'UTF-8', 'Utf-8', ' utf-8 '])
      expect(codes(charset(value)), value).toEqual([]);
    // The source reaches the editor as decoded text, so the declaration is corrected and the
    // author is told.
    for (const value of ['utf-7', 'UTF-7', 'iso-2022-jp', 'iso-8859-1', 'utf-16', 'utf8', '']) {
      expect(codes(charset(value)), JSON.stringify(value)).toEqual(['CHARSET_NORMALIZED']);
      expect(kept(charset(value)), JSON.stringify(value)).toContain('<meta charset="utf-8">');
    }
  });

  it('refuses a foreign charset from JSON as well', () => {
    const document = new HtmlDocumentCodec().import(
      { html: charset('utf-8'), css: '' },
      'email',
    ).document;
    if (!document) throw new Error('Rejected fixture');
    const tampered = JSON.parse(JSON.stringify(document).replace('"utf-8"', '"utf-7"')) as unknown;
    expect(JSON.stringify(tampered)).toContain('utf-7');
    expect(
      new ContentPolicy()
        .validate(EditorDocument.from(tampered).snapshot())
        .map((item) => item.code),
    ).toEqual(['FORBIDDEN_META_DIRECTIVE']);
  });
});

describe('downlevel-revealed conditionals', () => {
  const grammar = new DownlevelRevealedConditional();

  it('recognizes only exact markers over the closed expression vocabulary', () => {
    for (const value of [
      '[if !mso]',
      '[if mso]',
      '[if gte mso 9]',
      '[if (gte mso 9)|(IE)]',
      '[if mso | IE]',
      '[if !IE]',
      '[if lt mso 12.5]',
      '[if !(mso)]',
      '[if !(gte mso 9)]',
      '[if ((mso 16) | (IE 8)) & !(lt mso 12)]',
      '[if gte mso 9 & lt mso 16]',
      '[if lte IE 8]',
      '[if ( mso ) ]',
    ])
      expect(grammar.isOpening(value), value).toBe(true);
    expect(grammar.isClosing('[endif]')).toBe(true);
    for (const value of [
      '[if !mso]>',
      ' [if !mso]',
      '[if !mso] ',
      '[IF !mso]',
      '[if]',
      '[if ]',
      '[if 9]',
      '[if gte 9]',
      '[if true]',
      '[if vml]',
      '[if !mso]><script>alert(1)</script><![endif]',
      '[if mso]--',
      '[if mso;]',
      '[if mso<9]',
      '[if mso"]',
      '[if mso\n]',
      '[if mso 9999]',
      '[if !!!mso((((]',
      '[if !!mso]',
      '[if (mso]',
      '[if mso)]',
      '[if ((mso)]',
      '[if (mso))]',
      '[if )mso(]',
      '[if ()]',
      '[if (!)]',
      '[if !]',
      '[if mso |]',
      '[if | mso]',
      '[if mso & & IE]',
      '[if mso IE]',
      '[if mso mso]',
      '[if (mso)(IE)]',
      '[if gte]',
      '[if gte gt mso]',
      '[if mso gte 9]',
      '[if mso 9 9]',
      '[if 9 mso]',
      '[if mso !]',
      '[if &]',
      `[if ${'mso '.repeat(40)}]`,
      '[endif]>',
      '[ENDIF]',
      ' [endif]',
      '[endif]--',
    ])
      expect(grammar.isMarker(value), value).toBe(false);
  });

  it('imports the declaration form and keeps its bytes across an edit', () => {
    const html =
      '<table><tr><td><![if !mso]><a href="https://example.com">Bot&atilde;o</a><![endif]><!--[if mso]><p>Outlook</p><![endif]--></td></tr></table><p>alvo</p>';
    const codec = new HtmlDocumentCodec();
    const result = codec.import({ html, css: '' }, 'email');
    expect(result.diagnostics).toEqual([]);
    if (!result.document) throw new Error('Rejected fixture');
    expect(codec.export(result.document).html).toBe(html);
    const target = result.document.nodes[1];
    const text = target?.children?.[0];
    if (!target || !text) throw new Error('Missing fixture');
    const edited = {
      ...result.document,
      nodes: [result.document.nodes[0], { ...target, children: [{ ...text, value: 'editado' }] }],
    };
    expect(codec.export(EditorDocument.from(edited).snapshot()).html).toBe(
      html.replace('<p>alvo</p>', '<p>editado</p>'),
    );
  });

  it('keeps the declaration form when the JSON is reopened without the source', () => {
    const html = '<![if !mso]><p>fora do Outlook</p><![endif]><p>sempre</p>';
    const document = new HtmlDocumentCodec().import({ html, css: '' }, 'email').document;
    if (!document) throw new Error('Rejected fixture');
    const portable: unknown = JSON.parse(JSON.stringify(document));
    expect(new HtmlDocumentCodec().export(EditorDocument.from(portable).snapshot()).html).toBe(
      html,
    );
  });

  // The codec records the opener of every comment, so these forms of the closer are kept
  // exactly, with or without the source.
  it('keeps case and spacing variants of the closer as they were written', () => {
    for (const html of [
      '<![if !mso]><p>x</p><![ENDIF]>',
      '<![if !mso]><p>x</p><![Endif]>',
      '<![if !mso]><p>x</p><![endif] >',
      '<![if !mso]><p>x</p><! [endif]>',
      '<p>x</p><![ENDIF]>',
      '<p>x</p><!--[ENDIF]-->',
    ]) {
      expect(codes(html), html).toEqual([]);
      expect(kept(html), html).toBe(html);
      const document = new HtmlDocumentCodec().import({ html, css: '' }, 'email').document;
      const portable: unknown = JSON.parse(JSON.stringify(document));
      expect(
        new HtmlDocumentCodec().export(EditorDocument.from(portable).snapshot()).html,
        html,
      ).toBe(html);
    }
    expect(grammar.isClosingLookalike('[endif]')).toBe(false);
    expect(grammar.isClosingLookalike('endif')).toBe(false);
    expect(grammar.isClosingLookalike('[ENDIF]')).toBe(true);
  });

  // Unbalanced or nested markers used to refuse the e-mail (UNBALANCED_CONDITIONAL_COMMENT).
  // Exports of real tools hold them; they are the author's and are written back unchanged.
  it('keeps unbalanced and nested revealed markers as the author wrote them', () => {
    for (const html of [
      '<![if !mso]><p>x</p>',
      '<![endif]><p>x</p><![if !mso]>',
      '<![if !mso]><![if IE]><p>x</p><![endif]><![endif]>',
      '<![if !mso]><p>x</p><![endif]><![if IE]><p>y</p>',
      '<![if !mso]><p>x</p><![endif]><![if IE]><p>y</p><![endif]>',
      '<div><![if !mso]><p>x</p></div><div><![endif]></div>',
    ]) {
      expect(codes(html), html).toEqual([]);
      expect(kept(html), html).toBe(html);
    }
    for (const html of [
      '<table><tr><td><![if !mso]><p>x</p></td></tr></table>',
      '<table><tr><td><![if !mso]><p>x</p><![endif]></td></tr></table>',
    ])
      expect(codes(html), html).toEqual([]);
  });

  it('leaves an ordinary [endif] comment and hidden conditionals as they were', () => {
    const codec = new HtmlDocumentCodec();
    for (const html of [
      '<p>x</p><!--[endif]-->',
      '<!--[endif]--><p>x</p><!--[endif]-->',
      '<!--[if mso | IE]><table role="presentation"><tr><td><![endif]--><p>x</p><!--[if mso | IE]></td></tr></table><![endif]-->',
      '<!--[if !mso]><!--><p>x</p><!--<![endif]-->',
      '<!--[if mso]><p>Outlook</p><![endif]--><![if !mso]><p>x</p><![endif]>',
    ]) {
      const result = codec.import({ html, css: '' }, 'email');
      expect(result.diagnostics, html).toEqual([]);
      if (!result.document) throw new Error('Rejected fixture');
      expect(codec.export(result.document).html, html).toBe(html);
      const portable: unknown = JSON.parse(JSON.stringify(result.document));
      const reopened = EditorDocument.from(portable).snapshot();
      expect(new ContentPolicy().validate(reopened), html).toEqual([]);
      const again = codec.import(codec.export(reopened), 'email');
      expect(again.diagnostics, html).toEqual([]);
    }
  });

  // JSON with a changed marker is no longer refused: it is a document like the ones above.
  // What stays refused in JSON is text which would close the comment from inside.
  it('accepts changed markers from JSON and refuses only a comment which closes itself', () => {
    const document = new HtmlDocumentCodec().import(
      { html: '<![if !mso]><p>x</p><![endif]>', css: '' },
      'email',
    ).document;
    if (!document) throw new Error('Rejected fixture');
    const json = JSON.stringify(document);
    const validate = (text: string): readonly string[] =>
      new ContentPolicy()
        .validate(EditorDocument.from(JSON.parse(text) as unknown).snapshot())
        .map((item) => item.code);
    expect(validate(json)).toEqual([]);
    expect(validate(json.replace('[endif]', 'fim'))).toEqual([]);
    expect(validate(json.replace('[endif]', '[ENDIF]'))).toEqual([]);
    expect(validate(json.replace('[endif]', '[endif]><script>alert(1)</script'))).toEqual([
      'INVALID_HTML_COMMENT',
    ]);
    const reopened = EditorDocument.from(
      JSON.parse(json.replace('[endif]', '[ENDIF]')) as unknown,
    ).snapshot();
    expect(new HtmlDocumentCodec().export(reopened).html).toBe('<![if !mso]><p>x</p><![ENDIF]>');
  });

  // The body between revealed markers is ordinary tree content. In an e-mail what may not
  // travel is removed with a notice instead of refusing the message.
  it('applies the e-mail removals to the revealed body like to any other markup', () => {
    expect(codes('<![if !mso]><script>alert(1)</script><![endif]>')).toEqual(['SCRIPT_REMOVED']);
    expect(kept('<![if !mso]><script>alert(1)</script><p>x</p><![endif]>')).toBe(
      '<![if !mso]><p>x</p><![endif]>',
    );
    expect(codes('<![if !mso]><a href="javascript:alert(1)">x</a><![endif]>')).toEqual([
      'UNSAFE_URL_REMOVED',
    ]);
    expect(kept('<![if !mso]><a href="javascript:alert(1)">x</a><![endif]>')).toBe(
      '<![if !mso]><a>x</a><![endif]>',
    );
    expect(codes('<![if !mso]><p onclick="x()">x</p><![endif]>')).toEqual([
      'INLINE_HANDLER_REMOVED',
    ]);
  });

  // Near misses of the opener were refused because they could not be told apart in the tree.
  // With the opener recorded they are kept exactly as written.
  it('keeps near misses of the opening marker exactly as written', () => {
    for (const html of [
      '<![if !mso]x><p>x</p><![endif]>',
      '<![IF !mso]><p>x</p><![endif]>',
      '<![if vml]><p>x</p><![endif]>',
      '<![if expression(alert(1))]><p>x</p><![endif]>',
      '<![if mso & javascript]><p>x</p><![endif]>',
      '<!--[if mso]--><p>x</p>',
      '<![if !mso] ><p>x</p><![endif]>',
      '<!--[if mso]><!--[if IE]><p>x</p><![endif]--><![endif]-->',
      '<?xml version="1.0" encoding="utf-8"?><p>x</p>',
    ]) {
      expect(codes(html), html).toEqual([]);
      expect(kept(html), html).toBe(html);
      const document = new HtmlDocumentCodec().import({ html, css: '' }, 'email').document;
      const portable: unknown = JSON.parse(JSON.stringify(document));
      expect(
        new HtmlDocumentCodec().export(EditorDocument.from(portable).snapshot()).html,
        html,
      ).toBe(html);
    }
    // A hidden conditional is kept as source; only what an e-mail may not carry is cut out.
    const hidden = '<!--[if mso]><script>alert(1)</script><p onclick="x()">Outlook</p><![endif]-->';
    expect(codes(hidden)).toEqual(['SCRIPT_REMOVED', 'INLINE_HANDLER_REMOVED']);
    expect(kept(hidden)).toBe('<!--[if mso]><p >Outlook</p><![endif]-->');
  });
});

describe('spaces in URLs', () => {
  const urls = new UrlPolicy();

  it('accepts a space in the path or query of http(s) and after the colon of mailto and tel', () => {
    for (const value of [
      'https://x.test/my image.png',
      'http://x.test/a b/c d.html?q=um dois',
      'https://x.test?q=um dois',
      'HTTPS://x.test/A B',
      'https://x.test/{{contact.id}}/a b',
    ])
      expect(urls.isSafe(value, 'link'), value).toBe(true);
    expect(urls.isSafe('https://x.test/my image.png', 'image')).toBe(true);
    for (const value of [
      'mailto:a@b.com?subject=Ola mundo',
      'mailto:a@b.com?subject=Ola mundo&body=Tudo bem',
      'tel:+55 11 99999-0000',
    ]) {
      expect(urls.isSafe(value, 'link'), value).toBe(true);
      expect(urls.isSafe(value, 'image'), value).toBe(false);
    }
  });

  it('refuses a space or control before or inside the scheme and the authority', () => {
    for (const value of [
      'java script:alert(1)',
      ' javascript:alert(1)',
      'javascript:alert(1) ',
      'jav\tascript:alert(1)',
      'jav\nascript:alert(1)',
      'jav\rascript:alert(1)',
      'javascript :alert(1)',
      'javascript: alert(1)',
      'data: text/html,<script>alert(1)</script>',
      'data:text/html, <script>alert(1)</script>',
      'vbscript: msgbox(1)',
      'h ttps://x.test/a',
      'https ://x.test/a',
      'https: //x.test/a',
      'https:/ /x.test/a',
      'https:/x.test/a b',
      'https:x.test/a b',
      'https://x .test/a',
      'https://x.test /a',
      'https://user name@x.test/a',
      'https://x.test:80 80/a',
      'https://x.test#a b',
      'https://x.test/a#b c',
      'https://x.test#frag/a b',
      'https://x.test\\a b',
      'https://x.test/a\\ b',
      'mail to:a@b.com',
      'mailto :a@b.com',
      'te l:123',
      'sms:+55 11',
      'whatsapp://send?text=a b',
      'ftp://x.test/a b',
      '//cdn.test/a b.png',
      '/relative/a b.png',
      'relative a.png',
      '#a b',
      '?q=a b',
    ]) {
      expect(urls.isSafe(value, 'link'), JSON.stringify(value)).toBe(false);
      expect(urls.isSafe(value, 'image'), JSON.stringify(value)).toBe(false);
    }
  });

  it('refuses every control character and DEL in any position', () => {
    const controls = [...Array.from({ length: 32 }, (_, code) => code), 127];
    for (const code of controls) {
      const character = String.fromCharCode(code);
      for (const value of [
        `https://x.test/a${character}b`,
        `https://x.test/a b${character}c`,
        `mailto:a@b.com?subject=Ola${character}mundo`,
        `htt${character}ps://x.test/a`,
        `java${character}script:alert(1)`,
      ])
        expect(urls.isSafe(value, 'link'), JSON.stringify(value)).toBe(false);
    }
    expect(urls.isSafe('https://x.test/a\nb')).toBe(false);
  });

  it('refuses Unicode separators and zero-width marks in any position', () => {
    const points = [
      0x85,
      0xa0,
      0x1680,
      0x3000,
      0xfeff,
      ...Array.from({ length: 0x200f - 0x2000 + 1 }, (_, offset) => 0x2000 + offset),
      ...Array.from({ length: 0x202f - 0x2028 + 1 }, (_, offset) => 0x2028 + offset),
      ...Array.from({ length: 0x2064 - 0x205f + 1 }, (_, offset) => 0x205f + offset),
    ];
    expect(points).toHaveLength(35);
    for (const point of points) {
      const character = String.fromCodePoint(point);
      for (const value of [
        `${character}https://x.test/a`,
        `${character}javascript:alert(1)`,
        `https://x.test/a${character}`,
        `https://x.test/a${character}b`,
        `https://x.test/a b?q=${character}`,
        `https://x${character}.test/a`,
        `java${character}script:alert(1)`,
        `mailto:a@b.com?subject=Ola${character}mundo`,
        `${character}{{unsubscribe_url}}`,
        `/relative${character}`,
        character,
      ]) {
        expect(urls.isSafe(value, 'link'), `U+${point.toString(16)} ${value}`).toBe(false);
        expect(urls.isSafe(value, 'image'), `U+${point.toString(16)} ${value}`).toBe(false);
      }
    }
    // Neighbouring code points and ordinary non-ASCII text stay accepted.
    for (const value of ['https://x.test/café', 'https://x.test/日本', 'https://x.test/‐'])
      expect(urls.isSafe(value, 'link'), value).toBe(true);
    // The editor still never writes such a URL (the assertions above). In an imported
    // document it is the author's text and no browser reads it as a script URL, so it stays.
    expect(codes('<a href="https://x.test/a">x</a>')).toEqual([]);
    expect(codes('<a href="&#x200b;javascript:alert(1)">x</a>')).toEqual([]);
    expect(codes('<img src="https://x.test/a.png&#xa0;" alt="">')).toEqual([]);
    expect(
      new CssDocumentCodec()
        .validate('p{background:url("\u200bhttps://x.test/a.png")}')
        .map((item) => item.code),
    ).toEqual(['UNSAFE_CSS_URL']);
  });

  // The strict rule still governs what the editor writes (UrlPolicy.isSafe and the strict CSS
  // validation). An imported e-mail is no longer refused: only a URL a client could run as
  // code loses its attribute, and anything else is the author's.
  it('removes code URLs from attributes and keeps the strict rule for what the editor writes', () => {
    expect(codes('<a href="mailto:a@b.com?subject=Ola mundo">x</a>')).toEqual([]);
    expect(codes('<img src="https://x.test/my image.png" alt="">')).toEqual([]);
    expect(codes('<a href="java script:alert(1)">x</a>')).toEqual(['UNSAFE_URL_REMOVED']);
    expect(codes('<a href="javascript :alert(1)">x</a>')).toEqual(['UNSAFE_URL_REMOVED']);
    expect(codes('<a href="jav&#9;ascript:alert(1)">x</a>')).toEqual(['UNSAFE_URL_REMOVED']);
    expect(kept('<a href="jav&#9;ascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(codes('<a href="https://x.test/a&#10;b">x</a>')).toEqual([]);
    expect(codes('<img src="data: text/html,x" alt="">')).toEqual(['UNSAFE_URL_REMOVED']);
    const css = new CssDocumentCodec();
    expect(css.validate('p{background:url("https://x.test/my image.png")}')).toEqual([]);
    expect(
      css.validate('p{background:url("java script:alert(1)")}').map((item) => item.code),
    ).toEqual(['UNSAFE_CSS_URL']);
  });

  // An imported e-mail keeps them. The editor itself still does not write such links (isSafe is unchanged).
  it('keeps protocol-relative, sms and whatsapp links in an imported e-mail', () => {
    for (const value of ['//cdn.test/a.png', 'sms:+5511999990000', 'whatsapp://send?text=oi'])
      expect(urls.isSafe(value, 'link'), value).toBe(false);
    for (const html of [
      '<a href="//cdn.test/a.png">x</a><a href="sms:+5511999990000">y</a><a href="whatsapp://send?text=oi">z</a>',
      '<img srcset="https://x.test/a.png 2x" alt="">',
      '<svg><circle r="1"/></svg>',
      '<v:background fill="t"></v:background>',
    ]) {
      expect(codes(html), html).toEqual([]);
      expect(kept(html), html).toBe(html);
    }
    const link = '<link rel="stylesheet" href="https://fonts.test/a.css">';
    expect(codes(link)).toEqual(['EXTERNAL_STYLE_PRESERVED']);
    expect(kept(link)).toBe(link);
    const imported = new HtmlDocumentCodec().import(
      { html: '<p>x</p>', css: '@import url("https://x.test/a.css");' },
      'email',
    );
    expect(imported.document?.css).toBe('@import url("https://x.test/a.css");');
    expect(imported.diagnostics.map((item) => item.code)).toEqual(['EXTERNAL_STYLE_PRESERVED']);
  });
});
