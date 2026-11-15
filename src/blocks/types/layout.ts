import type { Block, BlockNodeType, BlockProps } from '../../core/block-document';
import { SECTION_LAYOUT_LIMITS } from '../../core/section-layout';
import type {
  BlockField,
  BlockTypeDefinition,
  EmailBlockContext,
  PageBlockContext,
} from '../block-type';
import { fields } from '../fields';

/** Content blocks a column holds. A form only exists in a page (checked by its definition). */
export const COLUMN_CONTENT: readonly BlockNodeType[] = Object.freeze([
  'text',
  'heading',
  'image',
  'button',
  'divider',
  'spacer',
  'footer',
  'form',
  'html',
]);

/** Weight of a column within its section; the shares are the weights over their sum. */
export function columnWeight(block: Block): number {
  const weight = block.props.weight;
  return typeof weight === 'number' ? weight : 1;
}

/** A band of the piece: one to four real columns, side by side, stacked on small screens. */
export class SectionBlock implements BlockTypeDefinition {
  readonly type = 'section';
  readonly labelKey = 'blocks.section';
  readonly kinds = ['email', 'page'] as const;
  readonly root = true;
  readonly childTypes: readonly BlockNodeType[] = ['column'];
  readonly childCount = { min: 1, max: SECTION_LAYOUT_LIMITS.columns };
  readonly fields: readonly BlockField[] = [
    fields.color('background', 'properties.background', 'body.contentBackground'),
    fields.padding(undefined, 'section.padding'),
    {
      key: 'stackReverse',
      tab: 'advanced',
      control: 'toggle',
      labelKey: 'blockFields.stackReverse',
      value: { type: 'toggle' },
      defaultValue: false,
    },
    ...fields.visibility(),
  ];

  create(nextId: () => string, props: BlockProps = {}): Block {
    return {
      id: nextId(),
      type: 'section',
      props,
      children: [new ColumnBlock().create(nextId)],
    };
  }

  /**
   * Reversed stacking: the columns are written in reverse order and the section lays them out
   * right to left, so a large screen shows them as authored and a small one stacks them from
   * the last. MJML keeps the text of each column left to right.
   */
  email(context: EmailBlockContext): string {
    const reverse = context.value('stackReverse') === true;
    return `<mj-section${context.attributes(reverse ? { direction: 'rtl' } : {})}>${context.children(reverse)}</mj-section>`;
  }

  page(context: PageBlockContext): string {
    const columns = (context.block.children ?? []).map(columnWeight);
    if (columns.length > 1)
      context.rule(
        ' > .ve-columns',
        `grid-template-columns:${columns.map((weight) => `minmax(0,${weight}fr)`).join(' ')}`,
      );
    if (columns.length > 1 && context.value('stackReverse') === true)
      context.mobileRule(' > .ve-columns', 'display:flex;flex-direction:column-reverse');
    return `<section${context.classes('ve-section')}${context.node()}><div class="ve-columns">${context.children()}</div></section>`;
  }
}

export class ColumnBlock implements BlockTypeDefinition {
  readonly type = 'column';
  readonly labelKey = 'blocks.column';
  readonly kinds = ['email', 'page'] as const;
  readonly childTypes = COLUMN_CONTENT;
  readonly childCount = { min: 0, max: 200 };
  readonly fields: readonly BlockField[] = [
    {
      key: 'weight',
      tab: 'style',
      control: 'select',
      labelKey: 'blockFields.columnWeight',
      value: { type: 'integer', min: 1, max: SECTION_LAYOUT_LIMITS.weight },
      defaultValue: 1,
      internal: true,
    },
    fields.color('background', 'properties.background'),
    {
      key: 'verticalAlign',
      tab: 'style',
      control: 'select',
      labelKey: 'blockFields.verticalAlign',
      value: { type: 'select', options: ['top', 'middle', 'bottom'] },
      options: [
        { value: 'top', labelKey: 'properties.alignStart' },
        { value: 'middle', labelKey: 'properties.alignCenter' },
        { value: 'bottom', labelKey: 'properties.alignEnd' },
      ],
      defaultValue: 'top',
      mjml: { attribute: 'vertical-align' },
      css: { property: 'align-self', map: { top: 'start', middle: 'center', bottom: 'end' } },
    },
    fields.padding('0'),
  ];

  create(nextId: () => string, props: BlockProps = {}): Block {
    return { id: nextId(), type: 'column', props, children: [] };
  }

  email(context: EmailBlockContext): string {
    return `<mj-column${context.attributes({ width: context.columnWidth })}>${context.children()}</mj-column>`;
  }

  page(context: PageBlockContext): string {
    return `<div${context.classes('ve-column')}${context.node()}>${context.children()}</div>`;
  }
}
