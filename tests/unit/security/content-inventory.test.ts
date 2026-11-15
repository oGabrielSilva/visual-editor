import { describe, expect, it } from 'vitest';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { CssDocumentCodec } from '../../../src/codecs/css';
import { ContentService } from '../../../src/application/content-service';
import { DocumentMutationService } from '../../../src/application/document-commands';
import { BlockCatalog } from '../../../src/core/catalog';
import type { DocumentNode } from '../../../src/core/document';
import { ContentPolicy } from '../../../src/security/policy';
import { RichTextProjection } from '../../../src/security/rich-text-projection';
import { UrlPolicy } from '../../../src/security/url-policy';
import { EMAIL_HANDMADE, LANDING_PAGE } from '../fixtures/real-world';

const policy = new ContentPolicy();
const codec = new HtmlDocumentCodec(policy);

describe('ContentPolicy.inspect: what the host decides publication over', () => {
  it('returns the typed inventory of a landing page', () => {
    const document = codec.import({ html: LANDING_PAGE, css: '' }, 'page').document;
    if (!document) throw new Error('Refused');
    expect(policy.inspect(document)).toEqual({
      kind: 'page',
      scripts: {
        // Tag manager, pixel and the script kept inside the template.
        inline: 3,
        external: [
          {
            url: 'https://code.jquery.com/jquery-3.7.1.min.js',
            origin: 'https://code.jquery.com',
          },
          {
            url: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
            origin: 'https://cdn.jsdelivr.net',
          },
        ],
        // JSON-LD is data: browsers never run it.
        data: 1,
      },
      frames: [
        // Found inside the text of <noscript>.
        {
          url: 'https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX',
          origin: 'https://www.googletagmanager.com',
        },
        { url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', origin: 'https://www.youtube.com' },
      ],
      embeds: 0,
      stylesheets: [
        {
          url: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap',
          origin: 'https://fonts.googleapis.com',
        },
        {
          url: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
          origin: 'https://cdn.jsdelivr.net',
        },
        {
          url: 'https://fonts.googleapis.com/css2?family=Lora&display=swap',
          origin: 'https://fonts.googleapis.com',
        },
      ],
      links: [
        {
          url: 'https://fonts.googleapis.com',
          origin: 'https://fonts.googleapis.com',
          rel: 'preconnect',
        },
        {
          url: 'https://fonts.gstatic.com',
          origin: 'https://fonts.gstatic.com',
          rel: 'preconnect',
        },
        { url: '//cdn.example.com/favicon.ico', origin: 'https://cdn.example.com', rel: 'icon' },
      ],
      forms: {
        count: 1,
        actions: [{ url: 'https://forms.example.com/submit', origin: 'https://forms.example.com' }],
      },
      inlineHandlers: 1,
      scriptUrls: 1,
      metaRefresh: 0,
      baseUrls: [],
      charsets: ['utf-8'],
      fontFaces: 1,
      activeCss: 0,
    });
  });

  it('sees what a document hides in conditional comments, noscript, templates and SVG', () => {
    const document = codec.import(
      {
        html: [
          '<!--[if mso]><script src="https://a.invalid/a.js"></script><a href="javascript:x()" onclick="y()">x</a><![endif]-->',
          '<noscript><iframe src="https://b.invalid/frame"></iframe><link rel="stylesheet" href="https://b.invalid/n.css"></noscript>',
          '<template><form action="https://c.invalid/post"><object data="x.swf"></object></form></template>',
          '<svg><script>z()</script><a xlink:href="javascript:w()"><circle onload="v()"/></a></svg>',
          '<p style="width:expression(alert(1))">x</p>',
          '<meta http-equiv="refresh" content="5"><base href="https://d.invalid/"><meta charset="windows-1252">',
        ].join(''),
        css: '',
      },
      'page',
    ).document;
    if (!document) throw new Error('Refused');
    const inventory = policy.inspect(document);
    expect(inventory.scripts.inline).toBe(1);
    expect(inventory.scripts.external).toEqual([
      { url: 'https://a.invalid/a.js', origin: 'https://a.invalid' },
    ]);
    expect(inventory.frames).toEqual([
      { url: 'https://b.invalid/frame', origin: 'https://b.invalid' },
    ]);
    expect(inventory.embeds).toBe(1);
    expect(inventory.stylesheets).toEqual([
      { url: 'https://b.invalid/n.css', origin: 'https://b.invalid' },
    ]);
    expect(inventory.forms).toEqual({
      count: 1,
      actions: [{ url: 'https://c.invalid/post', origin: 'https://c.invalid' }],
    });
    expect(inventory.inlineHandlers).toBe(2);
    expect(inventory.scriptUrls).toBe(2);
    expect(inventory.metaRefresh).toBe(1);
    expect(inventory.baseUrls).toEqual(['https://d.invalid/']);
    expect(inventory.charsets).toEqual(['windows-1252']);
    expect(inventory.activeCss).toBe(1);
  });

  it('reports a clean inventory for an e-mail after the import removed what it may not carry', () => {
    const imported = codec.import({ html: EMAIL_HANDMADE, css: '' }, 'email');
    if (!imported.document) throw new Error('Refused');
    const inventory = policy.inspect(imported.document);
    expect(inventory.kind).toBe('email');
    expect(inventory.scripts).toEqual({ inline: 0, external: [], data: 0 });
    expect(inventory.frames).toEqual([]);
    expect(inventory.embeds + inventory.inlineHandlers + inventory.scriptUrls).toBe(0);
    expect(inventory.forms.count).toBe(1);
    // Legacy IE filters are not code and are not counted as active CSS.
    expect(inventory.activeCss).toBe(0);
  });

  it('never changes the document it inspects and refuses what is not a document', () => {
    const document = codec.import({ html: LANDING_PAGE, css: '' }, 'page').document;
    if (!document) throw new Error('Refused');
    const before = JSON.stringify(document);
    policy.inspect(document);
    expect(JSON.stringify(document)).toBe(before);
    expect(() => policy.inspect({ ...document, schemaVersion: 2 } as never)).toThrow(
      'INVALID_DOCUMENT_SCHEMA',
    );
  });
});

describe('what the editor itself writes stays restricted', () => {
  const urls = new UrlPolicy();
  const css = new CssDocumentCodec(urls);
  const content = new ContentService(codec, policy, css);
  const mutations = new DocumentMutationService(content, new BlockCatalog());
  const find = (nodes: readonly DocumentNode[], tag: string): DocumentNode => {
    const stack = [...nodes];
    while (stack.length) {
      const node = stack.shift();
      if (node?.tag === tag) return node;
      stack.push(...(node?.children ?? []));
    }
    throw new Error(`Missing ${tag}`);
  };

  it('keeps the rich text projection free of scripts, handlers, embeds and code URLs', () => {
    const projection = new RichTextProjection(urls);
    const projected = projection.project(
      '<p onclick="x()">a<script>x()</script><iframe src="https://x.invalid"></iframe><a href="javascript:x()">b</a><a href="//x.invalid">c</a><a href="{{ any_tag }}">d</a><svg onload="x()"><circle/></svg><img src="x" onerror="x()"><a href="https://ok.example" onmouseover="x()">e</a></p>',
    );
    expect(projected.adjusted).toBe(true);
    expect(projected.html).toBe('<p>abcd<a href="https://ok.example">e</a></p>');
  });

  it.each(['page', 'email'] as const)(
    'refuses a text returned by the frame with a code URL or a handler in a %s',
    (kind) => {
      const document = codec.import(
        { html: '<p>Um <a href="https://example.com">link</a></p>', css: '' },
        kind,
      ).document;
      if (!document) throw new Error('Refused');
      const paragraph = find(document.nodes, 'p');
      for (const html of [
        'Um <a href="javascript:steal()">link</a>',
        'Um <a href="vbscript:steal()">link</a>',
        'Um <a href="data:text/html,x">link</a>',
        'Um <a href="//protocol.relative">link</a>',
        'Um <a href="https://example.com" onclick="steal()">link</a>',
        'Um <span onmouseover="steal()">texto</span>',
        'Um <script>steal()</script>',
        'Um <iframe src="https://x.invalid"></iframe>',
      ]) {
        expect(
          () => mutations.validateRichTextProjection(document, paragraph.id, html),
          html,
        ).toThrow();
        expect(() => mutations.richText(document, paragraph.id, html), html).toThrow();
      }
      expect(() =>
        mutations.richText(document, paragraph.id, 'Um <a href="https://example.org">link</a>'),
      ).not.toThrow();
    },
  );

  it.each(['page', 'email'] as const)(
    'refuses commands which would write a code URL or a handler in a %s',
    (kind) => {
      const document = codec.import(
        {
          html: '<a href="https://example.com">Link</a><img src="https://example.com/a.png" alt="">',
          css: '',
        },
        kind,
      ).document;
      if (!document) throw new Error('Refused');
      const link = find(document.nodes, 'a');
      const image = find(document.nodes, 'img');
      expect(() => mutations.attribute(document, link.id, 'href', 'javascript:steal()')).toThrow();
      expect(() => mutations.attribute(document, link.id, 'href', 'data:text/html,x')).toThrow();
      expect(() => mutations.attribute(document, image.id, 'src', 'javascript:steal()')).toThrow();
      expect(() =>
        mutations.attachAsset(
          document,
          { id: 'asset', url: 'javascript:steal()', alt: '' },
          image.id,
        ),
      ).toThrow();
      expect(() =>
        mutations.attribute(document, link.id, 'href', 'https://example.org'),
      ).not.toThrow();
      expect(() => mutations.style(document, link.id, 'color', 'expression(alert(1))')).toThrow();
    },
  );

  it('states the strict writing rule separately from what an import keeps', () => {
    const node = (attrs: Record<string, string>, tag = 'a'): DocumentNode[] => [
      { id: 'n', type: 'element', tag, attrs },
    ];
    expect(policy.writable(node({ href: 'https://example.com' }))).toBe(true);
    expect(policy.writable(node({ href: 'mailto:a@example.com' }))).toBe(true);
    expect(policy.writable(node({ href: '{{unsubscribe_url}}' }))).toBe(true);
    for (const attrs of [
      { href: 'javascript:x()' },
      { href: '//x.invalid' },
      { href: '{{ any }}' },
      { onclick: 'x()' },
      { srcset: 'https://x.invalid/a.png 2x' },
    ])
      expect(policy.writable(node(attrs)), JSON.stringify(attrs)).toBe(false);
    expect(policy.writable(node({}, 'script'))).toBe(false);
    expect(policy.writable(node({}, 'iframe'))).toBe(false);
    // The same content is accepted from an author's page: the two rules are independent.
    expect(
      codec.import({ html: '<a href="//x.invalid" onclick="x()">x</a>', css: '' }, 'page').document,
    ).toBeDefined();
  });
});
