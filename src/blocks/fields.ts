import type { BlockField, FieldOption } from './block-type';
import type { StylePath } from './styles';
import type { RichTextMode } from '../core/rich-text-markup';

/** Builders of the fields several block types share. Defaults follow MJML's own. */
export const ALIGN_OPTIONS: readonly FieldOption[] = Object.freeze([
  { value: 'left', labelKey: 'properties.alignLeft' },
  { value: 'center', labelKey: 'properties.alignCenter' },
  { value: 'right', labelKey: 'properties.alignRight' },
]);

export const BLOCK_PADDING = '10px 25px';

/** The two visibility toggles every block but a column has. */
export const DEVICE_KEYS = ['hideOnDesktop', 'hideOnMobile'] as const;

/** E-mail mobile rules shared by the text blocks: the cell and the text inside it. */
export const TEXT_MOBILE_EMAIL = Object.freeze({
  fontSize: { selectors: ['>div'] },
  lineHeight: { selectors: ['>div'] },
  align: { selectors: ['>div'] },
  padding: { selectors: [''] },
});

export const fields = Object.freeze({
  text(mode: RichTextMode): BlockField {
    return {
      key: 'text',
      tab: 'content',
      control: 'richtext',
      labelKey: 'properties.text',
      value: { type: 'richtext', mode },
      defaultValue: '',
    };
  },
  color(key: string, labelKey: string, inherits?: StylePath, target?: 'inner'): BlockField {
    return {
      key,
      tab: 'style',
      control: 'color',
      labelKey,
      value: { type: 'color' },
      ...(inherits ? { inherits } : {}),
      mjml: { attribute: key === 'background' ? 'background-color' : 'color' },
      css: {
        property: key === 'background' ? 'background-color' : 'color',
        ...(target ? { target } : {}),
      },
    };
  },
  fontSize(inherits: StylePath, target?: 'inner'): BlockField {
    return {
      key: 'fontSize',
      tab: 'style',
      control: 'length',
      labelKey: 'properties.fontSize',
      value: { type: 'length', units: ['px'], max: 160 },
      inherits,
      responsive: true,
      mjml: { attribute: 'font-size' },
      css: { property: 'font-size', ...(target ? { target } : {}) },
    };
  },
  lineHeight(inherits: StylePath): BlockField {
    return {
      key: 'lineHeight',
      tab: 'style',
      control: 'length',
      labelKey: 'properties.lineHeight',
      value: { type: 'ratio' },
      inherits,
      responsive: true,
      mjml: { attribute: 'line-height' },
      css: { property: 'line-height' },
    };
  },
  align(defaultValue: 'left' | 'center' | 'right', property = 'text-align'): BlockField {
    return {
      key: 'align',
      tab: 'style',
      control: 'select',
      labelKey: 'properties.textAlign',
      value: { type: 'select', options: ALIGN_OPTIONS.map((option) => option.value) },
      options: ALIGN_OPTIONS,
      defaultValue,
      responsive: true,
      mjml: { attribute: 'align' },
      css: { property },
    };
  },
  padding(defaultValue = BLOCK_PADDING, inherits?: StylePath): BlockField {
    return {
      key: 'padding',
      tab: 'advanced',
      control: 'length',
      labelKey: 'properties.padding',
      value: { type: 'box' },
      ...(inherits ? { inherits } : { defaultValue }),
      responsive: true,
      mjml: { attribute: 'padding' },
      css: { property: 'padding' },
    };
  },
  /** Hide the block on large or on small screens. The generators read them, not `css`. */
  visibility(): readonly BlockField[] {
    return DEVICE_KEYS.map((key) => ({
      key,
      tab: 'advanced' as const,
      control: 'toggle' as const,
      labelKey: `blockFields.${key}`,
      value: { type: 'toggle' as const },
      defaultValue: false,
    }));
  },
  link(key = 'href'): BlockField {
    return {
      key,
      tab: 'content',
      control: 'link',
      labelKey: 'properties.link',
      value: { type: 'url', purpose: 'link' },
    };
  },
});
