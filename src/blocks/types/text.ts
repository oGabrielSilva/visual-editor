import type { Block, BlockProps } from '../../core/block-document';
import { escapeHtml } from '../../core/html-escape';
import type {
  BlockField,
  BlockTypeDefinition,
  EmailBlockContext,
  PageBlockContext,
} from '../block-type';
import { TEXT_MOBILE_EMAIL, fields } from '../fields';

function text(context: { value(key: string): unknown }): string {
  const value = context.value('text');
  return typeof value === 'string' ? value : '';
}

/** Paragraphs, lists and quotes in the body typography of the piece. */
export class TextBlock implements BlockTypeDefinition {
  readonly type = 'text';
  readonly labelKey = 'blocks.text';
  readonly kinds = ['email', 'page'] as const;
  readonly childTypes = [];
  readonly childCount = { min: 0, max: 0 };
  readonly fields: readonly BlockField[] = [
    fields.text('block'),
    fields.color('color', 'properties.color', 'body.textColor'),
    fields.fontSize('body.fontSize'),
    fields.lineHeight('body.lineHeight'),
    fields.align('left'),
    fields.padding(),
    ...fields.visibility(),
  ];
  readonly mobileEmail = TEXT_MOBILE_EMAIL;

  create(nextId: () => string, props: BlockProps = {}): Block {
    return { id: nextId(), type: 'text', props };
  }

  email(context: EmailBlockContext): string {
    return `<mj-text${context.attributes()}>${text(context)}</mj-text>`;
  }

  page(context: PageBlockContext): string {
    return `<div${context.classes('ve-block ve-text')}${context.node()}${context.editable()}>${text(context)}</div>`;
  }
}

export const HEADING_LEVELS = ['h1', 'h2', 'h3'] as const;

/** A title in the heading typography of the piece, as a real `h1`-`h3`. */
export class HeadingBlock implements BlockTypeDefinition {
  readonly type = 'heading';
  readonly labelKey = 'blocks.heading';
  readonly kinds = ['email', 'page'] as const;
  readonly childTypes = [];
  readonly childCount = { min: 0, max: 0 };
  readonly fields: readonly BlockField[] = [
    fields.text('inline'),
    {
      key: 'level',
      tab: 'content',
      control: 'select',
      labelKey: 'blockFields.headingLevel',
      value: { type: 'select', options: HEADING_LEVELS },
      options: HEADING_LEVELS.map((level) => ({ value: level, labelKey: `blockFields.${level}` })),
      defaultValue: 'h2',
    },
    fields.color('color', 'properties.color', 'heading.color'),
    fields.fontSize('heading.fontSize'),
    fields.align('left'),
    fields.padding(),
    ...fields.visibility(),
  ];
  // The heading element carries its own font size and alignment inline: the rule reaches it.
  readonly mobileEmail = {
    fontSize: { selectors: ['>div', '>div>h1', '>div>h2', '>div>h3'] },
    align: { selectors: ['>div', '>div>h1', '>div>h2', '>div>h3'] },
    padding: { selectors: [''] },
  };

  create(nextId: () => string, props: BlockProps = {}): Block {
    return { id: nextId(), type: 'heading', props };
  }

  email(context: EmailBlockContext): string {
    // The heading element carries the effective values: some clients restyle `h1`-`h3`.
    const style = [
      'margin:0',
      `font-family:${context.styles.value('heading.fontFamily')}`,
      `font-size:${String(context.value('fontSize'))}`,
      `font-weight:${context.styles.value('heading.fontWeight')}`,
      `line-height:${context.styles.value('heading.lineHeight')}`,
      `color:${String(context.value('color'))}`,
    ].join(';');
    return `<mj-text mj-class="ve-heading"${context.attributes()}><${this.level(context)} style="${escapeHtml(style)}">${text(context)}</${this.level(context)}></mj-text>`;
  }

  page(context: PageBlockContext): string {
    const level = this.level(context);
    return `<${level}${context.classes('ve-block ve-heading')}${context.node()}${context.editable()}>${text(context)}</${level}>`;
  }

  private level(context: { value(key: string): unknown }): string {
    const level = context.value('level');
    return HEADING_LEVELS.find((entry) => entry === level) ?? 'h2';
  }
}

/** The closing lines of a piece in the footer typography. */
export class FooterBlock implements BlockTypeDefinition {
  readonly type = 'footer';
  readonly labelKey = 'blocks.footer';
  readonly kinds = ['email', 'page'] as const;
  readonly childTypes = [];
  readonly childCount = { min: 0, max: 0 };
  readonly fields: readonly BlockField[] = [
    fields.text('block'),
    fields.color('color', 'properties.color', 'footer.color'),
    fields.fontSize('footer.fontSize'),
    fields.align('left'),
    fields.padding(),
    ...fields.visibility(),
  ];
  readonly mobileEmail = TEXT_MOBILE_EMAIL;

  create(nextId: () => string, props: BlockProps = {}): Block {
    return { id: nextId(), type: 'footer', props };
  }

  email(context: EmailBlockContext): string {
    return `<mj-text mj-class="ve-footer"${context.attributes()}>${text(context)}</mj-text>`;
  }

  page(context: PageBlockContext): string {
    return `<footer${context.classes('ve-block ve-footer')}${context.node()}${context.editable()}>${text(context)}</footer>`;
  }
}
