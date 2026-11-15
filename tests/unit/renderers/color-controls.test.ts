import { describe, expect, it } from 'vitest';
import { ColorStyleValue } from '../../../src/vue/components/ui/color-style-value';

describe('inert color presentation', () => {
  const colors = new ColorStyleValue();

  it('normalizes short hexadecimal and RGB without a false black swatch', () => {
    expect(colors.normalize('#Fc0')).toBe('#ffcc00');
    expect(colors.normalize('#1a2b')).toBe('#11aa22bb');
    expect(colors.normalize('#123456')).toBe('#123456');
    expect(colors.normalize('#12345678')).toBe('#12345678');
    expect(colors.normalize('rgb(18, 52, 86)')).toBe('#123456');
    expect(colors.normalize('rgba(18, 52, 86, .5)')).toBe('#12345680');
    expect(colors.normalize(`rgba(18, 52, 86, ${128 / 255})`)).toBe('#12345680');
    expect(colors.normalize('rgb(18.4, 51.7, 86.1)')).toBe('#123456');
  });

  it('does not invent a swatch for inheritance, unknown functions or unsafe input', () => {
    for (const value of [
      '',
      'inherit',
      'var(--brand)',
      'url(https://example.test)',
      'red;position:fixed',
      '#12345',
      'rgb(256,0,0)',
      'rgba(0,0,0,2)',
    ]) {
      expect(colors.normalize(value)).toBeUndefined();
    }
  });

  it('keeps alpha when choosing a new RGB value and validates opacity', () => {
    expect(colors.opaque('#1234')).toBe('#112233');
    expect(colors.opacity('#1234')).toBe(27);
    expect(colors.preserveAlpha('#ffeedd', '#1234')).toBe('#ffeedd44');
    expect(colors.withOpacity('#123', 100)).toBe('#112233');
    expect(colors.withOpacity('#123', 0)).toBe('#11223300');
    expect(colors.withOpacity('#123', -1)).toBeUndefined();
    expect(colors.withOpacity('#123', 101)).toBeUndefined();
    expect(colors.withOpacity('#123', Infinity)).toBeUndefined();
  });
});
