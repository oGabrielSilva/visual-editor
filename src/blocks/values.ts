import type { BlockPropValue, StyleValue } from '../core/block-document';
import type { DocumentKind } from '../core/document';
import type { UrlPurpose } from '../security/url-policy';
import type { BlockContentGuard } from './content-guard';
import type { RichTextMode } from '../core/rich-text-markup';

/** The kind of value a property or a global style holds, and what it may contain. */
export type ValueSpec =
  | { readonly type: 'color' }
  | { readonly type: 'length'; readonly units: readonly ('px' | '%')[]; readonly max: number }
  | { readonly type: 'box' }
  | { readonly type: 'fontFamily' }
  | { readonly type: 'ratio' }
  | { readonly type: 'select'; readonly options: readonly string[] }
  | { readonly type: 'integer'; readonly min: number; readonly max: number }
  | { readonly type: 'toggle' }
  | { readonly type: 'plain'; readonly max: number; readonly pattern?: RegExp }
  | { readonly type: 'url'; readonly purpose: UrlPurpose }
  | { readonly type: 'richtext'; readonly mode: RichTextMode }
  | { readonly type: 'html' };

/** The font stacks a piece may use: written as they are into CSS and MJML, never typed. */
export const FONT_STACKS = [
  { value: 'Arial, Helvetica, sans-serif', labelKey: 'properties.fontSans' },
  { value: 'Georgia, Times New Roman, serif', labelKey: 'properties.fontSerif' },
  { value: 'Courier New, Courier, monospace', labelKey: 'properties.fontMonospace' },
] as const;

const COLOR =
  /^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|transparent|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d{1,4})\s*)?\))$/;
const LENGTH = /^(0|\d{1,4}(\.\d{1,2})?)(px|%)?$/;
const BOX_PART = /^(0|\d{1,3})(px)?$/;
const RATIO = /^\d(\.\d{1,3})?$/;
const URL_LENGTH = 16_384;
const TEXT_LENGTH = 100_000;

/**
 * Every value that reaches CSS, an MJML attribute or a URL passes one of these patterns: they
 * have no quote, semicolon, brace or angle bracket, so a value can never end the declaration
 * or the attribute it is written into.
 */
export class ValueRules {
  constructor(private readonly content: BlockContentGuard) {}

  accepts(spec: ValueSpec, value: BlockPropValue | StyleValue, kind: DocumentKind): boolean {
    switch (spec.type) {
      case 'toggle':
        return typeof value === 'boolean';
      case 'integer':
        return (
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value >= spec.min &&
          value <= spec.max
        );
      default:
        break;
    }
    if (typeof value !== 'string') return false;
    switch (spec.type) {
      case 'color':
        return COLOR.test(value);
      case 'length':
        return this.length(value, spec.units, spec.max);
      case 'box': {
        const parts = value.split(' ');
        return parts.length >= 1 && parts.length <= 4 && parts.every((part) => BOX_PART.test(part));
      }
      case 'fontFamily':
        return FONT_STACKS.some((stack) => stack.value === value);
      case 'ratio':
        return RATIO.test(value) && Number(value) > 0;
      case 'select':
        return spec.options.includes(value);
      case 'plain':
        return (
          value.length <= spec.max &&
          ![...value].some((character) => character.charCodeAt(0) < 32) &&
          (!spec.pattern || spec.pattern.test(value))
        );
      case 'url':
        return (
          value.trim().length > 0 &&
          value.length <= URL_LENGTH &&
          this.content.acceptsUrl(value, spec.purpose)
        );
      case 'richtext':
        return value.length <= TEXT_LENGTH && this.content.acceptsText(value, spec.mode, kind);
      case 'html':
        return this.content.acceptsHtml(value, kind);
    }
  }

  /** What a command stores: texts and HTML in their settled form, other values as given. */
  normalize(
    spec: ValueSpec,
    value: BlockPropValue | StyleValue,
    kind: DocumentKind,
  ): BlockPropValue | undefined {
    let candidate: BlockPropValue = value;
    if (typeof value === 'string') {
      if (spec.type === 'richtext') candidate = this.content.normalizeText(value, spec.mode, kind);
      else if (spec.type === 'html') candidate = this.content.normalizeHtml(value);
      else if (spec.type !== 'plain') candidate = value.trim();
    }
    return this.accepts(spec, candidate, kind) ? candidate : undefined;
  }

  private length(value: string, units: readonly ('px' | '%')[], max: number): boolean {
    const match = LENGTH.exec(value);
    if (!match) return false;
    const unit = match[3] as 'px' | '%' | undefined;
    if (unit === undefined) return value === '0';
    return units.includes(unit) && Number(match[1]) <= max;
  }
}
