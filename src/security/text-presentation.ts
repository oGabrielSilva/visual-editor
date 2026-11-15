import * as v from 'valibot';

export const TEXT_FONT_FAMILIES = [
  'Arial',
  'Georgia',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Times New Roman',
  'Courier New',
  'system-ui',
  'sans-serif',
  'serif',
  'monospace',
] as const;

export const TEXT_STYLE_LIMITS = Object.freeze({
  fontSizePx: 160,
  lineHeightPx: 500,
  lineHeightRatio: 10,
});

const component = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(255));
/** What a selected block looks like, as bounded numbers and closed names; never CSS text. */
export const TextPresentationStyleSchema = v.strictObject({
  size: v.pipe(v.number(), v.finite(), v.minValue(1), v.maxValue(TEXT_STYLE_LIMITS.fontSizePx)),
  lineHeight: v.union([
    v.literal('normal'),
    v.pipe(v.number(), v.finite(), v.minValue(1), v.maxValue(TEXT_STYLE_LIMITS.lineHeightPx)),
  ]),
  weight: v.pipe(v.number(), v.finite(), v.minValue(100), v.maxValue(900)),
  color: v.tuple([
    component,
    component,
    component,
    v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1)),
  ]),
  family: v.picklist(['sans-serif', 'serif', 'monospace']),
  font: v.exactOptional(v.picklist(TEXT_FONT_FAMILIES)),
  align: v.picklist(['left', 'right', 'center', 'justify']),
  direction: v.picklist(['ltr', 'rtl']),
});
export type CanvasTextStyle = v.InferOutput<typeof TextPresentationStyleSchema>;
