import type { Block, BlockProps } from '../../core/block-document';
import { escapeHtml } from '../../core/html-escape';
import type {
  BlockField,
  BlockTypeDefinition,
  EmailBlockContext,
  PageBlockContext,
} from '../block-type';
import { fields } from '../fields';

function string(context: { value(key: string): unknown }, key: string): string | undefined {
  const value = context.value(key);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Placeholder of an image without address, only in the editing frame. */
const EMPTY_IMAGE_HEIGHT = '120px';
const EMPTY_IMAGE_COLOR = '#e8eef0';

/**
 * An image from the media library (`assetId` + `url`) or an address, with its description.
 * Without an address it is only a placeholder in the preview and nothing in the output.
 */
export class ImageBlock implements BlockTypeDefinition {
  readonly type = 'image';
  readonly labelKey = 'blocks.image';
  readonly kinds = ['email', 'page'] as const;
  readonly childTypes = [];
  readonly childCount = { min: 0, max: 0 };
  readonly innerSelector = 'img';
  readonly fields: readonly BlockField[] = [
    {
      key: 'url',
      tab: 'content',
      control: 'image',
      labelKey: 'properties.imageUrl',
      value: { type: 'url', purpose: 'image' },
    },
    {
      key: 'assetId',
      tab: 'content',
      control: 'text',
      labelKey: 'properties.imageUrl',
      value: { type: 'plain', max: 128, pattern: /^[A-Za-z0-9_-]{1,128}$/ },
      internal: true,
    },
    {
      key: 'alt',
      tab: 'content',
      control: 'text',
      labelKey: 'properties.alternativeText',
      value: { type: 'plain', max: 1_000 },
      defaultValue: '',
    },
    fields.link(),
    {
      key: 'width',
      tab: 'style',
      control: 'length',
      labelKey: 'properties.width',
      value: { type: 'length', units: ['px'], max: 1_600 },
      mjml: { attribute: 'width' },
      css: { property: 'width', target: 'inner' },
      responsive: true,
    },
    fields.align('center'),
    fields.padding(),
    ...fields.visibility(),
  ];
  readonly mobileEmail = {
    width: { selectors: [' img'] },
    padding: { selectors: [''] },
  };

  create(nextId: () => string, props: BlockProps = {}): Block {
    return { id: nextId(), type: 'image', props };
  }

  email(context: EmailBlockContext): string {
    const url = string(context, 'url');
    if (!url) {
      const previewClass = context.previewClass();
      return previewClass
        ? `<mj-spacer height="${EMPTY_IMAGE_HEIGHT}" container-background-color="${EMPTY_IMAGE_COLOR}" css-class="${context.cellClass() ?? previewClass}"></mj-spacer>`
        : '';
    }
    return `<mj-image${context.attributes({
      src: url,
      alt: string(context, 'alt') ?? '',
      href: string(context, 'href'),
    })}></mj-image>`;
  }

  page(context: PageBlockContext): string {
    const url = string(context, 'url');
    if (!url)
      return context.mode === 'preview'
        ? `<div${context.classes('ve-block ve-image ve-image-empty')}${context.node()}></div>`
        : '';
    const href = string(context, 'href');
    const image = `<img src="${escapeHtml(url)}" alt="${escapeHtml(string(context, 'alt') ?? '')}">`;
    return `<div${context.classes('ve-block ve-image')}${context.node()}>${
      href ? `<a href="${escapeHtml(href)}">${image}</a>` : image
    }</div>`;
  }
}

/** A call to action. Its colors come from the global button style unless it sets its own. */
export class ButtonBlock implements BlockTypeDefinition {
  readonly type = 'button';
  readonly labelKey = 'blocks.button';
  readonly kinds = ['email', 'page'] as const;
  readonly childTypes = [];
  readonly childCount = { min: 0, max: 0 };
  readonly innerSelector = '.ve-button';
  readonly fields: readonly BlockField[] = [
    fields.text('button'),
    fields.link(),
    fields.color('background', 'properties.background', 'button.background', 'inner'),
    fields.color('color', 'properties.color', 'button.color', 'inner'),
    {
      key: 'radius',
      tab: 'style',
      control: 'length',
      labelKey: 'properties.borderRadius',
      value: { type: 'length', units: ['px'], max: 64 },
      inherits: 'button.radius',
      mjml: { attribute: 'border-radius' },
      css: { property: 'border-radius', target: 'inner' },
    },
    fields.fontSize('button.fontSize', 'inner'),
    {
      key: 'fullWidth',
      tab: 'style',
      control: 'toggle',
      labelKey: 'blockFields.fullWidth',
      value: { type: 'toggle' },
      defaultValue: false,
      mjml: { attribute: 'width', map: { true: '100%' } },
      css: { property: 'display', target: 'inner', map: { true: 'block' } },
    },
    fields.align('center'),
    fields.padding(),
    ...fields.visibility(),
  ];
  // The alignment of a button is the `align` of its cell, which CSS does not move: page only.
  readonly mobileEmail = {
    fontSize: { selectors: [' a', ' p'] },
    padding: { selectors: [''] },
  };

  create(nextId: () => string, props: BlockProps = {}): Block {
    return { id: nextId(), type: 'button', props };
  }

  email(context: EmailBlockContext): string {
    const text = string(context, 'text') ?? '';
    return `<mj-button${context.attributes({ href: string(context, 'href') })}>${text}</mj-button>`;
  }

  page(context: PageBlockContext): string {
    const href = string(context, 'href');
    const text = string(context, 'text') ?? '';
    return `<div${context.classes('ve-block ve-button-row')}${context.node()}><a class="ve-button"${
      href ? ` href="${escapeHtml(href)}"` : ''
    }${context.editable()}>${text}</a></div>`;
  }
}
