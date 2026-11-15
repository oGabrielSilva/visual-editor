import { describe, expect, it } from 'vitest';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { ContentPolicy } from '../../../src/security/policy';
import { CssDocumentCodec } from '../../../src/codecs/css';
import { EditorDocument } from '../../../src/core/document';
import type { EditorDocumentData } from '../../../src/core/document';
import { UrlPolicy } from '../../../src/security/url-policy';

/**
 * The editor never refuses the author's work for what it contains. An e-mail has the
 * active part removed with a notice; a page keeps it and reports it. That none of it runs
 * inside the editor is proven where it is enforced: the preview policy tests and the E2E.
 */
const executable = [
  '<script>alert(1)</script>',
  '<svg><a href="javascript:alert(1)">x</a></svg>',
  '<math><mtext><img src=x onerror=alert(1)></mtext></math>',
  '<img src="https://example.com/a.png" ONERROR="alert(1)">',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="java&#10;script:alert(1)">x</a>',
  '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
  '<template><script>alert(1)</script></template>',
  '<!--[if mso]><script>alert(1)</script><![endif]-->',
  '<!--[if mso]><a href="javascript:alert(1)">x</a><![endif]-->',
  '<!--[if mso]><img src=x onerror=alert(1)><![endif]-->',
  '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><script>alert(1)</script></o:OfficeDocumentSettings></xml></noscript><![endif]-->',
  '<noscript><img src=x onerror=alert(1)></noscript>',
  '<object data="https://attacker.invalid/x.swf"><embed src="https://attacker.invalid/x.swf"></object>',
  '<a href="vbscript:msgbox(1)">x</a>',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  '<form><button formaction="javascript:alert(1)">x</button></form>',
];

/**
 * Kept in a page, as its author wrote them. An e-mail loses them: a refresh
 * or a `base` changes where the message goes or where its addresses point.
 */
const navigation = [
  '<base href="https://attacker.invalid/">',
  '<meta http-equiv="refresh" content="0;url=https://attacker.invalid">',
  '<meta http-equiv="Refresh" content="5">',
  '<!--[if mso]><base href="https://attacker.invalid/"><![endif]-->',
];

/** Kept in both kinds: inert in a mail client and the author's own choice on a page. */
const preserved = [
  '<!--[if mso]><noscript><img src="https://example.com/x"></noscript><![endif]-->',
  '<img srcset="https://safe.invalid/a.png 1x, javascript:x 2x">',
  '<form action="https://attacker.invalid"><input name="password"></form>',
];

describe('ContentPolicy security boundary', () => {
  it('grants only exact host-configured URL placeholders to what the editor writes', () => {
    const placeholders = ['{{unsubscribeUrl}}', '{{webViewUrl}}'];
    const urls = new UrlPolicy({ exactUrlPlaceholders: placeholders });
    placeholders.push('{{contact.email}}');
    expect(urls.isSafe('{{unsubscribeUrl}}', 'link')).toBe(true);
    expect(urls.isSafe('{{unsubscribeUrl}}', 'image')).toBe(false);
    for (const href of [
      '{{contact.email}}',
      '{{unsubscribe_url}}',
      '{{unsubscribeUrl}}/path',
      'javascript:{{unsubscribeUrl}}',
    ])
      expect(urls.isSafe(href, 'link'), href).toBe(false);
    expect(() => new UrlPolicy({ exactUrlPlaceholders: ['javascript:x'] })).toThrow(
      'INVALID_URL_PLACEHOLDER_CONFIG',
    );
    // An imported document is the author's: merge tags of any tool stay in any URL position.
    // This used to refuse the import; only a URL which would run code loses its attribute.
    const codec = new HtmlDocumentCodec(new ContentPolicy(urls));
    for (const html of [
      '<a href="{{unsubscribeUrl}}">Preferências</a>',
      '<a href="{{contact.email}}">Link</a>',
      '<a href="{{ unsubscribe_url }}">Link</a>',
      '<a href="mailto:{{contact.email}}">Link</a>',
      '<a href="*|UNSUB|*">Link</a>',
      '<a href="%%unsubscribe%%">Link</a>',
      '<img src="{{unsubscribeUrl}}">',
    ]) {
      const imported = codec.import({ html, css: '' }, 'email');
      expect(imported.diagnostics, html).toEqual([]);
      if (!imported.document) throw new Error('Rejected fixture');
      expect(codec.export(imported.document).html, html).toBe(html);
    }
    const hostile = codec.import(
      { html: '<a href="javascript:{{unsubscribeUrl}}">Link</a>', css: '' },
      'email',
    );
    expect(hostile.diagnostics.map((item) => item.code)).toEqual(['UNSAFE_URL_REMOVED']);
    expect(hostile.document && codec.export(hostile.document).html).toBe('<a>Link</a>');
  });

  it.each(executable)('removes it from an e-mail with a notice, never refusing: %s', (html) => {
    const policy = new ContentPolicy();
    const codec = new HtmlDocumentCodec(policy);
    const imported = codec.import({ html, css: '' }, 'email');
    expect(imported.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    const removals = imported.diagnostics.filter((item) => item.severity === 'warning');
    expect(removals.length).toBeGreaterThan(0);
    for (const removal of removals) {
      expect(removal.code).toMatch(/^(SCRIPT|EMBED|INLINE_HANDLER|UNSAFE_URL)_REMOVED$/);
      expect(removal.count).toBeGreaterThan(0);
    }
    if (!imported.document) throw new Error('Refused');
    const inventory = policy.inspect(imported.document);
    expect(inventory.scripts.inline + inventory.scripts.external.length).toBe(0);
    expect(inventory.frames).toEqual([]);
    expect(inventory.embeds).toBe(0);
    expect(inventory.inlineHandlers).toBe(0);
    expect(inventory.scriptUrls).toBe(0);
    const output = codec.export(imported.document).html.toLowerCase();
    for (const fragment of ['<script', 'onerror', 'javascript:', 'vbscript:', '<iframe', '<embed'])
      expect(output, fragment).not.toContain(fragment);
    expect(output).not.toContain('<object');
    // The cleaned e-mail is itself a valid e-mail, with nothing left to remove.
    expect(() => policy.assertSafe(imported.document as EditorDocumentData)).not.toThrow();
    expect(policy.sanitize(imported.document).diagnostics).toEqual([]);
  });

  it.each(executable)('keeps it in a page byte for byte and reports it: %s', (html) => {
    const policy = new ContentPolicy();
    const codec = new HtmlDocumentCodec(policy);
    const imported = codec.import({ html, css: '' }, 'page');
    expect(imported.diagnostics.every((item) => item.severity === 'info')).toBe(true);
    expect(imported.diagnostics.length).toBeGreaterThan(0);
    if (!imported.document) throw new Error('Refused');
    expect(codec.export(imported.document).html).toBe(html);
    const portable: unknown = JSON.parse(JSON.stringify(imported.document));
    const fresh = new HtmlDocumentCodec();
    const reopened = fresh.import(
      fresh.export(EditorDocument.from(portable).snapshot()),
      'page',
    ).document;
    if (!reopened) throw new Error('Refused');
    expect(JSON.stringify(policy.inspect(reopened))).toBe(
      JSON.stringify(policy.inspect(imported.document)),
    );
  });

  it.each(navigation)(
    'keeps navigation only in a page and removes it from an e-mail: %s',
    (html) => {
      const page = new HtmlDocumentCodec();
      const kept = page.import({ html, css: '' }, 'page');
      expect(kept.diagnostics.filter((item) => item.severity !== 'info')).toEqual([]);
      expect(kept.document && page.export(kept.document).html).toBe(html);
      const email = new HtmlDocumentCodec();
      const cleaned = email.import({ html, css: '' }, 'email');
      expect(cleaned.diagnostics.map((item) => item.code)).toEqual(['UNSAFE_URL_REMOVED']);
      const exported = cleaned.document ? email.export(cleaned.document).html : '';
      expect(exported.toLowerCase()).not.toContain('<base');
      expect(exported.toLowerCase()).not.toContain('refresh');
      // What reaches the policy without the import is refused, and the editor never writes it.
      const policy = new ContentPolicy();
      const raw = page.inspect({ html, css: '' }, 'page').document;
      if (!raw) throw new Error('fixture');
      expect(
        policy.validate({ ...raw, kind: 'email' }).some((item) => item.code === 'UNSAFE_HTML_URL'),
      ).toBe(true);
      if (!html.startsWith('<!--')) expect(policy.writable(raw.nodes)).toBe(false);
    },
  );

  it.each(preserved)('keeps inert or author-owned markup in both kinds: %s', (html) => {
    for (const kind of ['email', 'page'] as const) {
      const codec = new HtmlDocumentCodec();
      const imported = codec.import({ html, css: '' }, kind);
      expect(
        imported.diagnostics.filter((item) => item.severity !== 'info'),
        kind,
      ).toEqual([]);
      if (!imported.document) throw new Error('Refused');
      expect(codec.export(imported.document).html, kind).toBe(html);
    }
  });

  it('keeps a code address written in CSS only in a page; an e-mail loses the sheet which has it', () => {
    const html = '<!--[if mso]><style>p{background:url(javascript:alert(1))}</style><![endif]-->';
    const page = new HtmlDocumentCodec();
    const kept = page.import({ html, css: '' }, 'page');
    expect(kept.diagnostics.filter((item) => item.severity !== 'info')).toEqual([]);
    expect(kept.document && page.export(kept.document).html).toBe(html);
    const email = new HtmlDocumentCodec();
    const cleaned = email.import({ html, css: '' }, 'email');
    expect(cleaned.diagnostics.map((item) => item.code)).toEqual(['ACTIVE_STYLE_REMOVED']);
    expect(cleaned.document && email.export(cleaned.document).html).toBe(
      '<!--[if mso]><![endif]-->',
    );
  });

  it('applies the rules of the kind to external JSON, never trusting a typed cast', () => {
    const policy = new ContentPolicy();
    const document: EditorDocumentData = {
      schemaVersion: 1,
      id: 'external',
      kind: 'page',
      revision: 0,
      title: '',
      css: '',
      nodes: [
        {
          id: 'script',
          type: 'element',
          tag: 'script',
          metadata: { blockType: 'text' },
          children: [{ id: 'code', type: 'text', value: 'track()' }],
        },
      ],
    };
    // A page may hold a script: the document is sound, the host decides.
    expect(() => policy.assertSafe(document)).not.toThrow();
    expect(policy.validate(document).map((item) => [item.code, item.severity])).toEqual([
      ['SCRIPT_PRESERVED', 'info'],
    ]);
    expect(policy.inspect(document).scripts.inline).toBe(1);
    // The same JSON as an e-mail is not accepted as it is: unsanitized it is an error, and
    // the entry of external JSON removes the script and says so.
    const email: EditorDocumentData = { ...document, kind: 'email' };
    expect(() => policy.assertSafe(email)).toThrow('UNSAFE_DOCUMENT');
    expect(policy.validate(email).map((item) => item.code)).toEqual(['FORBIDDEN_HTML_TAG']);
    const sanitized = policy.sanitize(email);
    expect(sanitized.document.nodes).toEqual([]);
    expect(sanitized.diagnostics).toEqual([
      {
        code: 'SCRIPT_REMOVED',
        severity: 'warning',
        messageKey: 'diagnostics.SCRIPT_REMOVED',
        count: 1,
      },
    ]);
    // A script which would close itself is not what a parser reads back: export refuses it.
    const breakout: EditorDocumentData = {
      ...document,
      nodes: [
        {
          id: 'script',
          type: 'element',
          tag: 'script',
          children: [{ id: 'code', type: 'text', value: '</script><img src=x onerror=alert(1)>' }],
        },
      ],
    };
    expect(() => new HtmlDocumentCodec().export(breakout)).toThrow('SERIALIZED_STRUCTURE_CHANGED');
    const subtree: EditorDocumentData = {
      ...document,
      nodes: [
        {
          id: 'script',
          type: 'element',
          tag: 'script',
          children: [{ id: 'child', type: 'element', tag: 'b', children: [] }],
        },
      ],
    };
    expect(policy.validate(subtree).map((item) => item.code)).toEqual(['INVALID_SOURCE_ELEMENT']);
    const comment: EditorDocumentData = {
      ...document,
      nodes: [{ id: 'comment', type: 'comment', value: '--><img src=x onerror=alert(1)><!--' }],
    };
    expect(() => new HtmlDocumentCodec().export(comment)).toThrow('UNSAFE_DOCUMENT');
    const doctype: EditorDocumentData = {
      ...document,
      nodes: [
        {
          id: 'doctype',
          type: 'doctype',
          value: 'html',
          attrs: { publicId: '\u0000', systemId: '' },
        },
      ],
    };
    expect(() => policy.assertSafe(doctype)).toThrow('UNSAFE_DOCUMENT');
    const foreign: EditorDocumentData = {
      ...document,
      nodes: [
        {
          id: 'path',
          type: 'element',
          tag: 'path',
          metadata: { namespace: 'http://www.w3.org/2000/svg' },
        },
      ],
    };
    expect(policy.validate(foreign).map((item) => item.code)).toEqual(['FORBIDDEN_NAMESPACE']);
  });

  it('accepts safe conditional e-mail markup and encoded text', () => {
    const html =
      '<p>&lt;script&gt;texto&lt;/script&gt;</p><!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="https://example.com" style="height:40px"><v:textbox>Botão</v:textbox></v:roundrect><![endif]-->';
    expect(new HtmlDocumentCodec().import({ html, css: '' }, 'email').diagnostics).toEqual([]);
  });

  it('bounds node depth and source size before recursion or rendering', () => {
    const codec = new HtmlDocumentCodec();
    const deep = (levels: number): string => '<div>'.repeat(levels) + 'x' + '</div>'.repeat(levels);
    expect(codec.import({ html: deep(100), css: '' }, 'page').document).toBeDefined();
    expect(codec.import({ html: deep(300), css: '' }, 'page').diagnostics).toEqual([
      { code: 'DOCUMENT_TOO_DEEP', severity: 'error', messageKey: 'diagnostics.DOCUMENT_TOO_DEEP' },
    ]);
    expect(
      codec.import({ html: 'x'.repeat(2_000_001), css: '' }, 'page').diagnostics[0]?.code,
    ).toBe('DOCUMENT_TOO_LARGE');
    expect(codec.import({ html: '😀'.repeat(500_001), css: '' }, 'page').diagnostics[0]?.code).toBe(
      'DOCUMENT_TOO_LARGE',
    );
    // Truncated or repeated markup was refused; it is now read the way every browser reads it.
    const truncated = codec.import({ html: '<p>ok</p><img src=x onerror=', css: '' }, 'page');
    expect(truncated.diagnostics).toEqual([]);
    expect(truncated.document?.nodes.map((node) => node.tag)).toEqual(['p']);
    const repeated = codec.import(
      { html: '<a href="#" HREF="https://two.invalid">Ambiguous</a>', css: '' },
      'page',
    );
    expect(repeated.document?.nodes[0]?.attrs).toEqual({ href: '#' });
  });

  it('keeps every meta directive of an e-mail in the document', () => {
    const codec = new HtmlDocumentCodec();
    expect(
      codec.import(
        {
          html: '<!DOCTYPE html><html><head><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body>Safe</body></html>',
          css: '',
        },
        'email',
      ).document,
    ).toBeDefined();
    // Formerly refused. The author's policy is kept in the document and removed only from
    // the copy the editor renders (tests/unit/security/preview-policy.test.ts).
    const html = '<meta http-equiv="Content-Security-Policy" content="script-src *">';
    const imported = codec.import({ html, css: '' }, 'email');
    expect(imported.diagnostics).toEqual([]);
    expect(imported.document && codec.export(imported.document).html).toBe(html);
  });
});

describe('CSS security', () => {
  it('exposes decoded URL references from the validated AST, including image-set', () => {
    const inspected = new CssDocumentCodec().inspect(
      'p{background:url(https://cdn.example/\\77 s/image.png);mask:image-set("https://cdn.example/\\77 s/other.png" 1x)}',
    );
    expect(inspected.diagnostics).toEqual([]);
    expect(inspected.urls).toEqual([
      'https://cdn.example/ws/image.png',
      'https://cdn.example/ws/other.png',
    ]);
    expect(new CssDocumentCodec().inspect('').urls).toEqual([]);
    const custom = new CssDocumentCodec().inspect(
      ':root{--image:"https://cdn.example/image.png";--label:"Arial, sans-serif"}p{background:image-set(var(--image) 1x)}',
    );
    expect(custom.diagnostics).toEqual([]);
    expect(custom.urlCandidates).toEqual(['https://cdn.example/image.png', 'Arial, sans-serif']);
  });
  it.each([
    'p{background:url(javascript:alert(1))}',
    'p{background:url("data:text/html,evil")}',
    'p{background:url("j\\61vascript:alert(1)")}',
    'p{width:expression(alert(1))}',
    'p{width:e\\78pression(alert(1))}',
    'p{behavior:url(https://attacker.invalid/a.htc)}',
    '@import "https://attacker.invalid/style.css";',
    '@\\69mport "https://attacker.invalid/style.css";',
    'p{background:image-set("javascript:alert(1)" 1x)}',
    '/* </style><script>alert(1)</script> */ p{color:red}',
  ])('keeps the strict gate for CSS the editor writes: %s', (css) => {
    // `validate` is what style commands and the rich text projection go through.
    expect(
      new CssDocumentCodec().validate(css).some((diagnostic) => diagnostic.severity === 'error'),
    ).toBe(true);
    expect(new CssDocumentCodec().richTextStyles(css)).toBeUndefined();
  });

  it('keeps the CSS of an imported page as written and reports what it loads', () => {
    // These stylesheets used to refuse the import. No current browser runs code from CSS; the
    // inventory tells the host what is there. An e-mail has them removed (see the tests of the
    // e-mail sanitizer).
    for (const kind of ['page'] as const) {
      const policy = new ContentPolicy();
      const codec = new HtmlDocumentCodec(policy);
      const css =
        '@import "https://fonts.example/style.css";@font-face{font-family:M;src:url(https://fonts.example/m.woff2)}p{width:expression(alert(1));behavior:url(https://x.invalid/a.htc);background:url("javascript:alert(1)");*zoom:1;filter:progid:DXImageTransform.Microsoft.gradient(startColorstr=\'#80000000\', endColorstr=\'#80000000\')}';
      const imported = codec.import({ html: '<p>Safe</p>', css }, kind);
      expect(imported.document?.css).toBe(css);
      expect(imported.diagnostics).toEqual([
        {
          code: 'EXTERNAL_STYLE_PRESERVED',
          severity: 'info',
          messageKey: 'diagnostics.EXTERNAL_STYLE_PRESERVED',
          count: 1,
        },
      ]);
      if (!imported.document) throw new Error('Refused');
      const inventory = policy.inspect(imported.document);
      expect(inventory.stylesheets).toEqual([
        { url: 'https://fonts.example/style.css', origin: 'https://fonts.example' },
      ]);
      expect(inventory.fontFaces).toBe(1);
      expect(inventory.activeCss).toBe(3);
    }
  });

  it('still refuses the one stylesheet which would close its own style element', () => {
    const imported = new HtmlDocumentCodec().import(
      { html: '<p>Safe</p>', css: '/* </style><script>alert(1)</script> */ p{color:red}' },
      'page',
    );
    expect(imported.document).toBeUndefined();
    expect(imported.diagnostics.map((item) => item.code)).toEqual(['CSS_HTML_BOUNDARY']);
    expect(
      new HtmlDocumentCodec().import({ html: '<p>x</p>', css: 'a{}'.repeat(200_000) }, 'page')
        .diagnostics[0]?.code,
    ).toBe('CSS_TOO_LARGE');
  });
});
