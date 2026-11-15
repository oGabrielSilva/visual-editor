import type { Block, BlockPropValue } from '../core/block-document';
import type { DocumentKind } from '../core/document';
import { EDIT_NODE_ATTRIBUTE, NODE_ATTRIBUTE } from '../core/canvas-contract';
import { escapeHtml } from '../core/html-escape';
import type {
  BlockTypeDefinition,
  EmailBlockContext,
  OutputMode,
  PageBlockContext,
} from './block-type';
import type { StyleResolver } from './styles';

/**
 * Class of a block in the page output: `ve-b-<id>`. The prefix keeps it apart from the
 * structural classes (`ve-page`, `ve-section`, `ve-button`...) whatever the id is.
 */
export function blockClass(block: Block): string {
  return `ve-b-${block.id}`;
}

/**
 * Class of a block in an e-mail preview: `ve-p-<token>-<id>`, with a token drawn for each
 * rendering, so markup of the author can never pose as a block for the marker.
 */
export function previewClass(token: string, block: Block): string {
  return `ve-p-${token}-${block.id}`;
}

/** Classes of a block hidden on a screen; the generators write what each one does. */
export const HIDE_DESKTOP_CLASS = 've-hide-d';
export const HIDE_MOBILE_CLASS = 've-hide-m';

/** Class of the cell of an e-mail block with mobile values: `ve-m-<id>`. */
export function mobileClass(block: Block): string {
  return `ve-m-${block.id}`;
}

/** The visibility classes of a block, in a fixed order. */
export function visibilityClasses(block: Block): readonly string[] {
  return [
    ...(block.props.hideOnDesktop === true ? [HIDE_DESKTOP_CLASS] : []),
    ...(block.props.hideOnMobile === true ? [HIDE_MOBILE_CLASS] : []),
  ];
}

/** Shared reading of values: own, else inherited, else the field default. */
abstract class BaseContext {
  constructor(
    readonly block: Block,
    readonly definition: BlockTypeDefinition,
    readonly kind: DocumentKind,
    readonly mode: OutputMode,
    readonly styles: StyleResolver,
    private readonly renderChildren: (reverse: boolean) => string,
  ) {}

  value(key: string): BlockPropValue | undefined {
    const own = this.block.props[key];
    if (own !== undefined) return own;
    const field = this.definition.fields.find((entry) => entry.key === key);
    if (field?.inherits) return this.styles.value(field.inherits);
    return field?.defaultValue;
  }

  children(reverse = false): string {
    return this.renderChildren(reverse);
  }
}

export class EmailRenderContext extends BaseContext implements EmailBlockContext {
  constructor(
    block: Block,
    definition: BlockTypeDefinition,
    mode: OutputMode,
    styles: StyleResolver,
    renderChildren: (reverse: boolean) => string,
    private readonly fragments: string[],
    private readonly token: string,
    readonly columnWidth?: string,
    /** Whether the generator wrote mobile rules for the cell of this block. */
    private readonly mobile = false,
  ) {
    super(block, definition, 'email', mode, styles, renderChildren);
  }

  attributes(extra: Readonly<Record<string, string | undefined>> = {}): string {
    const pairs: [string, string][] = [];
    for (const field of this.definition.fields) {
      const own = this.block.props[field.key];
      if (!field.mjml || own === undefined) continue;
      const value = field.mjml.map ? field.mjml.map[String(own)] : String(own);
      if (value !== undefined) pairs.push([field.mjml.attribute, value]);
    }
    for (const [name, value] of Object.entries(extra))
      if (value !== undefined) pairs.push([name, value]);
    const cellClass = this.cellClass();
    if (cellClass) pairs.push(['css-class', cellClass]);
    return pairs.map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join('');
  }

  cellClass(): string | undefined {
    const preview = this.previewClass();
    const classes = [
      ...(preview ? [preview] : []),
      ...visibilityClasses(this.block),
      ...(this.mobile ? [mobileClass(this.block)] : []),
    ];
    return classes.length ? classes.join(' ') : undefined;
  }

  raw(fragment: string): string {
    this.fragments.push(fragment);
    return `<mj-raw>${fragment}</mj-raw>`;
  }

  previewClass(): string | undefined {
    return this.mode === 'preview' ? previewClass(this.token, this.block) : undefined;
  }
}

export class PageRenderContext extends BaseContext implements PageBlockContext {
  constructor(
    block: Block,
    definition: BlockTypeDefinition,
    mode: OutputMode,
    styles: StyleResolver,
    renderChildren: (reverse: boolean) => string,
    private readonly rules: string[],
    private readonly mobileRules: string[] = [],
  ) {
    super(block, definition, 'page', mode, styles, renderChildren);
  }

  classes(base: string): string {
    return ` class="${[base, blockClass(this.block), ...visibilityClasses(this.block)].join(' ')}"`;
  }

  node(): string {
    return this.mode === 'preview' ? ` ${NODE_ATTRIBUTE}="${this.block.id}"` : '';
  }

  editable(): string {
    return this.mode === 'preview' ? ` ${EDIT_NODE_ATTRIBUTE}="${this.block.id}"` : '';
  }

  rule(selectorSuffix: string, declarations: string): void {
    this.rules.push(`.${blockClass(this.block)}${selectorSuffix}{${declarations}}`);
  }

  mobileRule(selectorSuffix: string, declarations: string): void {
    this.mobileRules.push(`.${blockClass(this.block)}${selectorSuffix}{${declarations}}`);
  }
}
