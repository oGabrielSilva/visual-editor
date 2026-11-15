import * as v from 'valibot';
export const IMAGE_SIZE_LIMITS = Object.freeze({ min: 1, max: 10000 });
export const DOCUMENT_STYLE_PROPERTIES = [
  'font-family',
  'font-size',
  'line-height',
  'color',
  'background-color',
] as const;
export type DocumentStyleProperty = (typeof DOCUMENT_STYLE_PROPERTIES)[number];
const dimension = v.pipe(
  v.number(),
  v.finite(),
  v.minValue(IMAGE_SIZE_LIMITS.min),
  v.maxValue(IMAGE_SIZE_LIMITS.max),
);
const imageSizeSchema = v.strictObject({
  width: dimension,
  height: v.exactOptional(dimension),
  preserveRatio: v.exactOptional(v.boolean()),
});
export type ImageSizeSettings = v.InferOutput<typeof imageSizeSchema>;

/** Canonical bounded presentation settings, independent of adapters. */
export class DocumentPresentationPolicy {
  image(input: unknown): ImageSizeSettings {
    return v.parse(imageSizeSchema, input);
  }
  dimension(input: unknown): number {
    return v.parse(dimension, input);
  }
  safeDimension(input: unknown): number | undefined {
    const result = v.safeParse(dimension, input);
    return result.success ? result.output : undefined;
  }
  style(property: unknown, value: unknown): void {
    v.parse(v.picklist(DOCUMENT_STYLE_PROPERTIES), property);
    v.parse(v.pipe(v.string(), v.maxLength(256)), value);
  }
}
