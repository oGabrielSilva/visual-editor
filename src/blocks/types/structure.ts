import type { Block, BlockProps } from '../../core/block-document';
import type {
  BlockField,
  BlockTypeDefinition,
  EmailBlockContext,
  PageBlockContext,
} from '../block-type';
import { fields } from '../fields';

/** A horizontal rule in the global divider style. */
export class DividerBlock implements BlockTypeDefinition {
  readonly type = 'divider';
  readonly labelKey = 'blocks.divider';
  readonly kinds = ['email', 'page'] as const;
  readonly childTypes = [];
  readonly childCount = { min: 0, max: 0 };
  readonly innerSelector = 'hr';
  readonly fields: readonly BlockField[] = [
    {
      key: 'color',
      tab: 'style',
      control: 'color',
      labelKey: 'properties.borderColor',
      value: { type: 'color' },
      inherits: 'divider.color',
      mjml: { attribute: 'border-color' },
      css: { property: 'border-top-color', target: 'inner' },
    },
    {
      key: 'thickness',
      tab: 'style',
      control: 'length',
      labelKey: 'properties.borderWidth',
      value: { type: 'length', units: ['px'], max: 16 },
      inherits: 'divider.width',
      mjml: { attribute: 'border-width' },
      css: { property: 'border-top-width', target: 'inner' },
    },
    fields.padding(),
    ...fields.visibility(),
  ];
  readonly mobileEmail = { padding: { selectors: [''] } };

  create(nextId: () => string, props: BlockProps = {}): Block {
    return { id: nextId(), type: 'divider', props };
  }

  email(context: EmailBlockContext): string {
    return `<mj-divider${context.attributes()}></mj-divider>`;
  }

  page(context: PageBlockContext): string {
    return `<div${context.classes('ve-block ve-divider')}${context.node()}><hr></div>`;
  }
}

/** Vertical space. */
export class SpacerBlock implements BlockTypeDefinition {
  readonly type = 'spacer';
  readonly labelKey = 'blocks.spacer';
  readonly kinds = ['email', 'page'] as const;
  readonly childTypes = [];
  readonly childCount = { min: 0, max: 0 };
  readonly fields: readonly BlockField[] = [
    {
      key: 'height',
      tab: 'style',
      control: 'length',
      labelKey: 'properties.height',
      value: { type: 'length', units: ['px'], max: 400 },
      defaultValue: '20px',
      mjml: { attribute: 'height' },
      css: { property: 'height' },
      responsive: true,
    },
    ...fields.visibility(),
  ];
  readonly mobileEmail = { height: { selectors: ['>div'], properties: ['height', 'line-height'] } };

  create(nextId: () => string, props: BlockProps = {}): Block {
    return { id: nextId(), type: 'spacer', props };
  }

  email(context: EmailBlockContext): string {
    return `<mj-spacer${context.attributes()}></mj-spacer>`;
  }

  page(context: PageBlockContext): string {
    return `<div${context.classes('ve-spacer')}${context.node()} aria-hidden="true"></div>`;
  }
}
