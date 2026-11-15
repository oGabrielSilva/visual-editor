import { describe, expect, it } from 'vitest';
import { BlockDocumentError } from '../../../src/core/block-document';
import type { Block } from '../../../src/core/block-document';
import { BlockContentGuard } from '../../../src/blocks/content-guard';
import { simple } from './support';

const guard = new BlockContentGuard();

function code(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof BlockDocumentError) return error.code;
    throw error;
  }
  return undefined;
}

const block = (type: Block['type'], props: Block['props']): Block => ({ id: 'b1', type, props });

describe('block content: rich text', () => {
  it('stores the projection the in-place editing protocol transports', () => {
    const document = simple([block('text', { text: '<p>x</p>' })]);
    const updated = document.updateText(
      'b1',
      'text',
      '<p style="color:#ff0000;background:url(https://x.y/a.png)" onclick="x()">Oi <a href="javascript:alert(1)">link</a> <a href="https://example.com" target="_blank">ok</a></p><img src=x onerror=alert(1)><script>alert(1)</script>',
    );
    // A style with a URL is dropped as a whole; script, handler and code link go away.
    expect(updated.find('b1')?.props.text).toBe(
      '<p>Oi link <a href="https://example.com" target="_blank">ok</a></p>',
    );
    expect(
      document.updateText('b1', 'text', '<p style="color:#ff0000">Oi</p>').find('b1')?.props.text,
    ).toBe('<p><span style="color:#ff0000">Oi</span></p>');
  });

  it('refuses stored text which is not a fixed point of the projection', () => {
    for (const text of [
      '<p onclick="x()">x</p>',
      '<script>x()</script>',
      '<p><a href="javascript:x()">x</a></p>',
      '<div>x</div>',
      '<p data-editor-rich-origin="n1">x</p>',
      '<p><img src="https://x.y/a.png"></p>',
    ])
      expect(code(() => simple([block('text', { text })]))).toBe('INVALID_BLOCK_TEXT');
    expect(guard.acceptsText('<p>Olá, <strong>Nico</strong></p>', 'block', 'email')).toBe(true);
    expect(guard.acceptsText('<ul><li>um</li></ul>', 'block', 'page')).toBe(true);
    expect(guard.acceptsText('', 'block', 'email')).toBe(true);
  });

  it('keeps a heading on one line with links', () => {
    expect(
      guard.normalizeText('<p>Um</p><p>Dois <a href="https://x.y">x</a></p>', 'inline', 'email'),
    ).toBe('Um<br>Dois <a href="https://x.y">x</a>');
    expect(code(() => simple([block('heading', { text: '<p>Um</p>' })]))).toBe(
      'INVALID_BLOCK_TEXT',
    );
    expect(code(() => simple([block('heading', { text: '<ul><li>x</li></ul>' })]))).toBe(
      'INVALID_BLOCK_TEXT',
    );
  });

  it('accepts a restricted projection without links in a button', () => {
    expect(
      guard.normalizeText(
        '<p><strong><a href="https://x.y">Comprar</a></strong> já</p>',
        'button',
        'email',
      ),
    ).toBe('<strong>Comprar</strong> já');
    expect(
      code(() => simple([block('button', { text: '<a href="https://x.y">Comprar</a>' })])),
    ).toBe('INVALID_BLOCK_TEXT');
    expect(simple([block('button', { text: 'Comprar <em>já</em>' })]).find('b1')?.props.text).toBe(
      'Comprar <em>já</em>',
    );
  });
});

describe('block content: addresses', () => {
  it('passes links and images through the URL policy', () => {
    expect(code(() => simple([block('button', { href: 'javascript:alert(1)' })]))).toBe(
      'UNSAFE_BLOCK_URL',
    );
    expect(code(() => simple([block('image', { url: 'data:text/html,<p>x</p>' })]))).toBe(
      'UNSAFE_BLOCK_URL',
    );
    expect(code(() => simple([block('image', { url: 'https://user:pw@x.y/a.png' })]))).toBe(
      'UNSAFE_BLOCK_URL',
    );
    expect(code(() => simple([block('image', { url: '' })]))).toBe('UNSAFE_BLOCK_URL');
    expect(
      simple([block('footer', { text: '<p><a href="{{unsubscribe_url}}">Sair</a></p>' })]).find(
        'b1',
      ),
    ).toBeDefined();
    expect(
      simple([block('image', { url: 'cid:logo', alt: 'Logo', assetId: 'asset_1' })]).find('b1'),
    ).toBeDefined();
    expect(
      code(() => simple([block('image', { url: 'https://x.y/a.png', assetId: '../x' })])),
    ).toBe('INVALID_BLOCK_PROPS');
    expect(
      code(() => simple([block('image', { url: 'https://x.y/a.png', alt: 'a\u0000b' })])),
    ).toBe('INVALID_BLOCK_PROPS');
  });
});

describe('block content: free HTML', () => {
  it('keeps active content in a page and refuses it in an e-mail', () => {
    const script = '<div>Oi</div><script>track()</script>';
    expect(simple([block('html', { html: script })], 'page').find('b1')?.props.html).toBe(script);
    expect(code(() => simple([block('html', { html: script })], 'email'))).toBe(
      'UNSAFE_BLOCK_HTML',
    );
    expect(
      code(() => simple([block('html', { html: '<a href="javascript:x()">x</a>' })], 'email')),
    ).toBe('UNSAFE_BLOCK_HTML');
    expect(
      code(() => simple([block('html', { html: '<div onclick="x()">x</div>' })], 'email')),
    ).toBe('UNSAFE_BLOCK_HTML');
    expect(
      simple(
        [block('html', { html: '<table><tbody><tr><td>x</td></tr></tbody></table>' })],
        'email',
      ).find('b1'),
    ).toBeDefined();
  });

  it('stores balanced markup so a block cannot close the elements around it', () => {
    const document = simple([block('html', { html: '<p>x</p>' })], 'email');
    const updated = document.updateProps('b1', { html: '</td></tr></tbody></table><p>escape' });
    expect(updated.find('b1')?.props.html).toBe('<p>escape</p>');
    expect(code(() => simple([block('html', { html: '</td></tr><p>escape</p>' })], 'email'))).toBe(
      'UNSAFE_BLOCK_HTML',
    );
    expect(code(() => simple([block('html', { html: '</div></main><p>x</p>' })], 'page'))).toBe(
      'INVALID_BLOCK_HTML',
    );
  });

  it('refuses MJML syntax and whole documents', () => {
    expect(
      code(() =>
        simple([block('html', { html: '<p title="</mj-raw><mj-include path=x>">x</p>' })], 'email'),
      ),
    ).toBe('UNSAFE_BLOCK_HTML');
    expect(
      code(() =>
        simple(
          [block('html', { html: '<html><head></head><body><p>x</p></body></html>' })],
          'page',
        ),
      ),
    ).toBe('INVALID_BLOCK_HTML');
  });
});

describe('free HTML', () => {
  const html = (value: string, kind: 'email' | 'page') =>
    code(() => simple([block('html', { html: value })], kind));
  const refusal = { email: 'UNSAFE_BLOCK_HTML', page: 'INVALID_BLOCK_HTML' } as const;

  it('refuses the canvas attributes and the generated classes in either kind', () => {
    for (const kind of ['email', 'page'] as const)
      for (const value of [
        '<div data-visual-editor-node="t1">x</div>',
        '<p data-visual-editor-edit-node="t1">x</p>',
        '<div class="hero ve-b-t1">x</div>',
        '<div class="ve-p-00000000000000000000000000000000-t1">x</div>',
        '<svg><g class="ve-b-x"></g></svg>',
        '<template><p class="ve-b-x">x</p></template>',
        '<!--[if mso]><p class="ve-b-x">x</p><![endif]-->',
      ])
        expect(html(value, kind), `${kind}: ${value}`).toBe(refusal[kind]);
    expect(html('<div class="hero vertical">x</div>', 'page')).toBeUndefined();
  });

  it('refuses plaintext in either kind', () => {
    expect(html('<plaintext>x</plaintext>', 'page')).toBe('INVALID_BLOCK_HTML');
    expect(html('<plaintext>x</plaintext>', 'email')).toBe('UNSAFE_BLOCK_HTML');
  });

  it('refuses in an e-mail what redirects it, renders markup as text or loads other styles', () => {
    for (const value of [
      '<meta http-equiv="refresh" content="5">',
      '<meta http-equiv="Content-Security-Policy" content="default-src *">',
      '<meta name="x" content="y">',
      '<base href="https://x.y/">',
      '<link rel="stylesheet" href="https://evil.example/a.css">',
      '<link rel="preload" href="https://evil.example/a.woff2">',
      '<style>@import url(https://evil.example/a.css);</style>',
      '<style>@font-face{font-family:x;src:url(https://evil.example/x.woff2)}</style>',
      '<xmp><img src=x onerror=alert(1)></xmp>',
      '<listing><img src=x onerror=alert(1)></listing>',
    ])
      expect(html(value, 'email'), value).toBe('UNSAFE_BLOCK_HTML');
    // A page keeps them, as its author wrote them.
    expect(
      html('<link rel="stylesheet" href="https://evil.example/a.css">', 'page'),
    ).toBeUndefined();
  });

  it('accepts Google Fonts as the only external style of an e-mail', () => {
    for (const value of [
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
      '<link rel="preconnect" href="https://fonts.gstatic.com/">',
      '<style>@import url(https://fonts.googleapis.com/css2?family=Inter);</style>',
      '<style>@font-face{font-family:x;src:url(https://fonts.gstatic.com/s/x.woff2)}</style>',
    ])
      expect(html(value, 'email'), value).toBeUndefined();
  });
});

describe('cache and fonts', () => {
  it('keeps hashes, not values, as cache keys', () => {
    const fresh = new BlockContentGuard();
    const big = `<p>${'a'.repeat(400_000)}</p>`;
    expect(fresh.acceptsHtml(big, 'page')).toBe(true);
    expect(fresh.acceptsHtml(big, 'page')).toBe(true);
    const footprint = fresh.cacheFootprint();
    expect(footprint.entries).toBe(1);
    expect(footprint.keyCharacters).toBeLessThan(100);
    for (let index = 0; index < 2_100; index++)
      fresh.acceptsText(`<p>${index}</p>`, 'block', 'page');
    expect(fresh.cacheFootprint().entries).toBe(2_000);
  });

  it('accepts only the font stacks of the catalog', () => {
    const styles = (fontFamily: string) =>
      code(() => simple([]).updateStyles({ body: { fontFamily } }));
    expect(styles('Georgia, Times New Roman, serif')).toBeUndefined();
    for (const value of ["Arial'", 'Arial, sans-serif', 'Comic Sans MS'])
      expect(styles(value), value).toBe('INVALID_GLOBAL_STYLES');
  });
});
