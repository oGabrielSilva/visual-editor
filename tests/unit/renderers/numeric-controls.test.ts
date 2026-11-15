import { describe, expect, it } from 'vitest';
import { TEXT_STYLE_LIMITS } from '../../../src/security/text-presentation';
import { NumericStyleValue } from '../../../src/vue/components/ui/numeric-style-value';

describe('numeric style controls', () => {
  it('uses the canonical limit for each rich-text line-height unit', () => {
    const value = new NumericStyleValue(['', 'px'], 1, TEXT_STYLE_LIMITS.lineHeightPx, {
      '': TEXT_STYLE_LIMITS.lineHeightRatio,
    });
    expect(value.parse('100')).toBeUndefined();
    expect(value.create('100', '')).toBeUndefined();
    expect(value.parse('100px')).toEqual({ amount: 100, unit: 'px' });
    expect(value.create('10', '')).toBe('10');
  });

  it('preserves unsupported shorthands and expressions until explicit replacement', () => {
    const value = new NumericStyleValue(['px', 'rem', 'em', '%']);
    expect(value.parse('12px 24px')).toBeUndefined();
    expect(value.parse('calc(100% - 8px)')).toBeUndefined();
    expect(value.parse('var(--brand-size)')).toBeUndefined();
    expect(value.create('16', 'px')).toBe('16px');
  });

  it('accepts finite measures only within supplied bounds and units', () => {
    const value = new NumericStyleValue(['px', '%'], 0, 100);
    expect(value.parse('12.5px')).toEqual({ amount: 12.5, unit: 'px' });
    expect(value.create('100', '%')).toBe('100%');
    expect(value.create('', 'px')).toBeUndefined();
    expect(value.create('Infinity', 'px')).toBeUndefined();
    expect(value.create('-1', 'px')).toBeUndefined();
    expect(value.create('101', 'px')).toBeUndefined();
    expect(value.create('12', 'rem')).toBeUndefined();
    expect(value.parse('12px;color:red')).toBeUndefined();
  });

  it('supports unitless line heights and signed tracking without changing other controls', () => {
    const line = new NumericStyleValue(['', 'px'], 0, 100);
    const tracking = new NumericStyleValue(['px', 'em'], -100, 100);
    expect(line.parse('1.5')).toEqual({ amount: 1.5, unit: '' });
    expect(tracking.create('-0.05', 'em')).toBe('-0.05em');
    expect(new NumericStyleValue(['px']).parse('-2px')).toBeUndefined();
  });
});
