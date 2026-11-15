import { describe, expect, it } from 'vitest';
import { BlockContentGuard } from '../../../src/blocks/content-guard';
import { ActiveMarkupRules } from '../../../src/security/markup-rules';

describe('free HTML: generated classes in markup kept as text', () => {
  const guard = (): BlockContentGuard => new BlockContentGuard();

  it('still refuses a generated class written inside a comment', () => {
    expect(guard().acceptsHtml('<!--[if mso]><p class="x ve-b-1">a</p><![endif]-->', 'page')).toBe(
      false,
    );
    expect(guard().acceptsHtml('<!-- class=ve-p-1 -->', 'email')).toBe(false);
    expect(guard().acceptsHtml('<!-- class="move-on" --><p>ok</p>', 'page')).toBe(true);
  });

  it('reads a long run of unterminated attributes in linear time', () => {
    const hostile = 'class='.repeat(80_000);
    const start = performance.now();
    guard().acceptsHtml(hostile, 'page');
    // The former expression took about 24 s on 500 KB; a linear reading takes milliseconds.
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});

describe('event handler attributes', () => {
  const rules = new ActiveMarkupRules();

  it('treats engine-prefixed and before/after handlers as handlers', () => {
    for (const name of [
      'onwebkitmouseforcedown',
      'onwebkitmouseforcechanged',
      'onwebkitbeginfullscreen',
      'onmozfullscreenchange',
      'onbeforexrselect',
      'onafterprint',
      'OnWebkitMouseForceUp',
    ])
      expect(rules.attribute(name, 'alert(1)'), name).toBe('handler');
  });

  it('keeps ordinary attributes that only start with "on"', () => {
    for (const name of ['onboarding', 'one', 'only'])
      expect(rules.attribute(name, 'x')).toBe(undefined);
  });
});
