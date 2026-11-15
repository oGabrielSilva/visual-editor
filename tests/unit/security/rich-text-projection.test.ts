import { UrlPolicy } from '../../../src/security/url-policy';
import { describe, expect, it } from 'vitest';
import { RichTextProjection } from '../../../src/security/rich-text-projection';

const projection = new RichTextProjection();

describe('authenticated rich-text projection', () => {
  it('removes loading and host-style surfaces before any native DOM parser runs', () => {
    const result = projection.project(
      '<p id="app" class="fixed" style="background:url(https://probe.test/a)" onclick="run()"><img src="https://probe.test/image"><span background="https://probe.test/bg">Safe</span></p><iframe src="https://probe.test/frame"></iframe><form action="https://probe.test/post"><input autofocus>Text</form>',
    );
    expect(result.html).toBe('<p><span>Safe</span></p>Text');
    expect(result.adjusted).toBe(true);
    expect(result.html).not.toContain('probe.test');
  });

  it('does not retain executable or foreign-namespace content', () => {
    const result = projection.project(
      '<script>alert(1)</script><style>body{display:none}</style><svg><foreignObject><p>Unsafe namespace</p></foreignObject></svg><math><mtext>Foreign</mtext></math><p>Visible</p>',
    );
    expect(result.html).toBe('<p>Visible</p>');
    expect(result.adjusted).toBe(true);
  });

  it('validates decoded links and keeps harmless text from rejected anchors', () => {
    const result = projection.project(
      '<p><a href="java&#x73;cript:run()">Rejected</a> <a href="https://safe.test/path?a=1&amp;b=2" target="_blank" rel="noopener" title="Label">Safe</a></p>',
    );
    expect(result.html).toBe(
      '<p>Rejected <a href="https://safe.test/path?a=1&amp;b=2" target="_blank" rel="noopener" title="Label">Safe</a></p>',
    );
    expect(result.adjusted).toBe(true);
  });

  it('preserves bounded opaque identities and Unicode without allowing an attribute breakout', () => {
    const result = projection.project(
      '<p><span data-editor-rich-origin="保 &quot; &lt;">Olá &amp; Nico 🧭</span><u>Sublinhado</u></p>',
    );
    expect(result.html).toBe(
      '<p><span data-editor-rich-origin="保 &quot; &lt;">Olá &amp; Nico 🧭</span><u>Sublinhado</u></p>',
    );
    expect(result.adjusted).toBe(false);
    expect(projection.project(`<p data-editor-rich-origin="${'a'.repeat(201)}">A</p>`).html).toBe(
      '<p>A</p>',
    );
  });

  it('preserves lists and headings only when the region supports block content', () => {
    const input = '<h2>Heading</h2><ol start="2"><li>Item</li></ol>';
    expect(projection.project(input, true)).toEqual({ html: input, adjusted: false });
    expect(projection.project(input, false)).toEqual({ html: 'HeadingItem', adjusted: true });
    expect(projection.project('<p>&lt;img src=x&gt; &amp; &#x1F9ED;</p>').html).toBe(
      '<p>&lt;img src=x&gt; &amp; 🧭</p>',
    );
  });

  it('fails closed before parsing oversized source or rendering an excessive tree', () => {
    expect(() => projection.project('a'.repeat(2_000_001))).toThrow();
    expect(() => projection.project('<span>'.repeat(82) + 'A' + '</span>'.repeat(82))).toThrow(
      'RICH_TEXT_TOO_COMPLEX',
    );
  });
});

it('preserves exact URL variables accepted by the configured document policy', () => {
  const urls = new UrlPolicy({ exactUrlPlaceholders: ['{{profileUrl}}', '{{unsubscribeUrl}}'] });
  const projection = new RichTextProjection(urls);
  expect(projection.project('<p><a href="{{profileUrl}}">Perfil</a></p>').html).toBe(
    '<p><a href="{{profileUrl}}">Perfil</a></p>',
  );
  expect(projection.project('<p><a href="{{unknown}}">Desconhecido</a></p>').html).toBe(
    '<p>Desconhecido</p>',
  );
  expect(projection.project('<p><a href="javascript:steal()">Seguro</a></p>').html).toBe(
    '<p>Seguro</p>',
  );
});
