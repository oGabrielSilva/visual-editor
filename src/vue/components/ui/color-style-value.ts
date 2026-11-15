import * as v from 'valibot';

/** Normalizes bounded inert colors without replacing source values the picker cannot represent. */
export class ColorStyleValue {
  private readonly hexadecimal = v.pipe(
    v.string(),
    v.regex(/^#[\da-f]{3,4}$|^#[\da-f]{6}(?:[\da-f]{2})?$/i),
  );

  normalize(input: string): string | undefined {
    const value = input.trim().toLowerCase();
    if (value.length > 128) return undefined;
    if (v.safeParse(this.hexadecimal, value).success) {
      const digits = value.slice(1);
      return digits.length <= 4
        ? `#${[...digits].map((digit) => `${digit}${digit}`).join('')}`
        : value;
    }
    const rgb =
      /^rgba?\(\s*(\d{1,3}(?:\.\d{1,12})?)\s*,\s*(\d{1,3}(?:\.\d{1,12})?)\s*,\s*(\d{1,3}(?:\.\d{1,12})?)(?:\s*,\s*(\d(?:\.\d{1,20})?|\.\d{1,20}))?\s*\)$/.exec(
        value,
      );
    if (!rgb) return undefined;
    const raw = rgb.slice(1, 4).map(Number);
    const alpha = rgb[4] === undefined ? undefined : Number(rgb[4]);
    if (raw.some((channel) => channel > 255) || (alpha !== undefined && alpha > 1))
      return undefined;
    const channels = raw.map(Math.round);
    if (alpha !== undefined) channels.push(Math.round(alpha * 255));
    return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  }

  opaque(input: string): string | undefined {
    return this.normalize(input)?.slice(0, 7);
  }

  preserveAlpha(input: string, source: string): string | undefined {
    const opaque = this.opaque(input);
    const original = this.normalize(source);
    return opaque ? `${opaque}${original?.length === 9 ? original.slice(7) : ''}` : undefined;
  }

  opacity(input: string): number {
    const value = this.normalize(input);
    return value?.length === 9 ? Math.round((parseInt(value.slice(7), 16) / 255) * 100) : 100;
  }

  withOpacity(input: string, opacity: number): string | undefined {
    const value = this.opaque(input);
    if (!value || !Number.isFinite(opacity) || opacity < 0 || opacity > 100) return undefined;
    return opacity === 100
      ? value
      : `${value}${Math.round((opacity / 100) * 255)
          .toString(16)
          .padStart(2, '0')}`;
  }
}
