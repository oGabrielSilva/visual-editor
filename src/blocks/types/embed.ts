import type { Block, BlockProps } from '../../core/block-document';
import { escapeHtml } from '../../core/html-escape';
import type {
  BlockField,
  BlockTypeDefinition,
  EmailBlockContext,
  PageBlockContext,
} from '../block-type';
import { fields } from '../fields';

/** Where the host renders one of its forms. Only in a page; the reference is the host's. */
export class FormBlock implements BlockTypeDefinition {
  readonly type = 'form';
  readonly labelKey = 'blocks.form';
  readonly kinds = ['page'] as const;
  readonly childTypes = [];
  readonly childCount = { min: 0, max: 0 };
  readonly fields: readonly BlockField[] = [
    {
      key: 'reference',
      tab: 'content',
      control: 'text',
      labelKey: 'properties.form',
      value: { type: 'plain', max: 128, pattern: /^[A-Za-z0-9_-]{1,128}$/ },
    },
    fields.padding(),
    ...fields.visibility(),
  ];

  create(nextId: () => string, props: BlockProps = {}): Block {
    return { id: nextId(), type: 'form', props };
  }

  page(context: PageBlockContext): string {
    const reference = context.value('reference');
    return `<div${context.classes('ve-block ve-form')}${context.node()} data-host-slot="form"${
      typeof reference === 'string' ? ` data-host-reference="${escapeHtml(reference)}"` : ''
    }></div>`;
  }
}

/**
 * Free HTML written by the author. In a page it is kept as written (balanced by the parser);
 * in an e-mail it must already follow the e-mail rules and is emitted through `mj-raw`, the
 * only raw region the compilation accepts, and only from this generator.
 */
export class HtmlBlock implements BlockTypeDefinition {
  readonly type = 'html';
  readonly labelKey = 'blocks.customHtml';
  readonly kinds = ['email', 'page'] as const;
  readonly childTypes = [];
  readonly childCount = { min: 0, max: 0 };
  readonly fields: readonly BlockField[] = [
    {
      key: 'html',
      tab: 'content',
      control: 'code',
      labelKey: 'blockFields.html',
      value: { type: 'html' },
      defaultValue: '',
    },
    fields.padding('0'),
    ...fields.visibility(),
  ];
  readonly mobileEmail = { padding: { selectors: [''] } };

  create(nextId: () => string, props: BlockProps = {}): Block {
    return { id: nextId(), type: 'html', props };
  }

  email(context: EmailBlockContext): string {
    const cellClass = context.cellClass();
    const html = context.value('html');
    // MJML zeroes the font size of a column (`font-size:0px`) and sets it again on each
    // component; the free HTML gets the text style of the piece back in its own wrapper.
    const text = escapeHtml(
      [
        `font-family:${context.styles.value('body.fontFamily')}`,
        `font-size:${context.styles.value('body.fontSize')}`,
        `line-height:${context.styles.value('body.lineHeight')}`,
        `color:${context.styles.value('body.textColor')}`,
      ].join(';'),
    );
    return context.raw(
      `<tr><td${cellClass ? ` class="${cellClass}"` : ''} style="padding:${String(
        context.value('padding'),
      )}"><div style="${text}">${typeof html === 'string' ? html : ''}</div></td></tr>`,
    );
  }

  page(context: PageBlockContext): string {
    const html = context.value('html');
    return `<div${context.classes('ve-html')}${context.node()}>${typeof html === 'string' ? html : ''}</div>`;
  }
}
