import type {
  Block,
  BlockDocumentData,
  BlockNodeType,
  BlockPropValue,
  BlockProps,
} from '../core/block-document';
import type { DocumentKind } from '../core/document';
import type { GlobalStyleSpec, StylePath, StyleResolver } from './styles';
import type { ValueSpec } from './values';

/** What the generators read of a piece: a `BlockDocument` or its validated data. */
export type BlockDocumentView = Pick<BlockDocumentData, 'kind' | 'meta' | 'styles' | 'blocks'>;

/** The definitions the generators need; implemented by `BlockDefinitionRegistry`. */
export interface BlockTypeCatalog {
  readonly styles: GlobalStyleSpec;
  definition(type: BlockNodeType): BlockTypeDefinition;
}

/** `preview` feeds the editing frame; `final` is what is sent or published. */
export type OutputMode = 'preview' | 'final';

export type FieldTab = 'content' | 'style' | 'advanced';
export type FieldControl =
  | 'text'
  /** Markup on several lines (the free HTML block), edited in the code editor of the shell. */
  | 'code'
  | 'richtext'
  | 'color'
  | 'length'
  | 'select'
  | 'image'
  | 'link'
  | 'toggle';

export interface FieldOption {
  readonly value: string;
  readonly labelKey: string;
}

/** One property of a block as the properties panel shows it and the generators read it. */
export interface BlockField {
  readonly key: string;
  readonly tab: FieldTab;
  readonly control: FieldControl;
  readonly labelKey: string;
  readonly value: ValueSpec;
  /** The global style this property inherits while the block does not set it. */
  readonly inherits?: StylePath;
  /** Value used while neither the block nor a global style says otherwise. */
  readonly defaultValue?: BlockPropValue;
  readonly options?: readonly FieldOption[];
  readonly required?: boolean;
  /** Hidden from the panel: set together with another field (e.g. the asset of an image). */
  readonly internal?: boolean;
  /**
   * The field may take a value of its own on small screens. A page writes it with `css`
   * inside the mobile rule; an e-mail only where the definition says how (`mobileEmail`).
   */
  readonly responsive?: boolean;
  /** MJML attribute written when the block overrides the value. */
  readonly mjml?: { readonly attribute: string; readonly map?: Readonly<Record<string, string>> };
  /** CSS declaration written in `.ve-<id>` when the block overrides the value. */
  readonly css?: {
    readonly property: string;
    readonly target?: 'self' | 'inner';
    readonly map?: Readonly<Record<string, string>>;
  };
}

interface RenderContext {
  readonly block: Block;
  readonly kind: DocumentKind;
  readonly mode: OutputMode;
  readonly styles: StyleResolver;
  /** The block's own value, else the inherited global style, else the field default. */
  value(key: string): BlockPropValue | undefined;
  /** Markup of the children, in order (reversed when asked). */
  children(reverse?: boolean): string;
}

export interface EmailBlockContext extends RenderContext {
  /** Width of a column within its section, e.g. `50%`. */
  readonly columnWidth?: string | undefined;
  /**
   * ` name="value"` pairs: overridden fields mapped to MJML, the extra pairs given here and,
   * in preview, the `css-class` of `previewClass()`. Values are escaped.
   */
  attributes(extra?: Readonly<Record<string, string | undefined>>): string;
  /** Registers a raw region of generated, sanitized markup and returns its `mj-raw`. */
  raw(fragment: string): string;
  /** In preview, the class the preview marker looks for; undefined otherwise. */
  previewClass(): string | undefined;
  /**
   * Every class of the cell of the block: the preview class, the device classes (hidden on a
   * screen, mobile values) and nothing else; undefined when there is none.
   */
  cellClass(): string | undefined;
}

export interface PageBlockContext extends RenderContext {
  /** ` class="<base> ve-b-<id>"`. */
  classes(base: string): string;
  /** In preview, the canvas attribute of a selectable block; empty otherwise. */
  node(): string;
  /** In preview, the canvas attribute of the element whose text is edited in place. */
  editable(): string;
  /** Adds a structural rule for this block, e.g. the grid of a section. */
  rule(selectorSuffix: string, declarations: string): void;
  /** The same, only on small screens. */
  mobileRule(selectorSuffix: string, declarations: string): void;
}

/**
 * How an e-mail writes the mobile value of a field: CSS rules for the cell `.ve-m-<id>` that
 * MJML gives the block (`''` is the cell itself, `'>div'` its text, `' a'` the link of a
 * button), each with the properties to set (by default the CSS property of the field).
 */
export interface MobileEmailRule {
  readonly selectors: readonly string[];
  readonly properties?: readonly string[];
}

/** What one block type is: its place in the tree, its fields and its two generators. */
export interface BlockTypeDefinition {
  readonly type: BlockNodeType;
  readonly labelKey: string;
  readonly kinds: readonly DocumentKind[];
  readonly root?: boolean;
  readonly childTypes: readonly BlockNodeType[];
  readonly childCount: { readonly min: number; readonly max: number };
  readonly fields: readonly BlockField[];
  /** CSS selector, relative to `.ve-b-<id>`, of the element `inner` overrides apply to. */
  readonly innerSelector?: string;
  /** By field key: how an e-mail writes its mobile value. A field absent here has none. */
  readonly mobileEmail?: Readonly<Partial<Record<string, MobileEmailRule>>>;
  /** A new block of this type with the given values. */
  create(nextId: () => string, props?: BlockProps): Block;
  email?(context: EmailBlockContext): string;
  page(context: PageBlockContext): string;
}
