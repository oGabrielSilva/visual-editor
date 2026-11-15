import type { GlobalStyles, StyleValue } from '../core/block-document';
import type { DocumentKind } from '../core/document';
import { FONT_STACKS } from './values';
import type { ValueSpec } from './values';

/** An MJML component, or a named `mj-class`, whose attribute carries a global style. */
export interface MjmlTarget {
  readonly element: 'mj-all' | 'mj-text' | 'mj-button' | 'mj-divider' | 'mj-section';
  readonly mjClass?: string;
  readonly attribute: string;
}

export interface StyleKeySpec {
  readonly key: string;
  readonly labelKey: string;
  readonly control: 'color' | 'length' | 'select';
  readonly value: ValueSpec;
  readonly default: string | Readonly<Record<DocumentKind, string>>;
  readonly options?: readonly { readonly value: string; readonly labelKey: string }[];
  /** Where an e-mail carries it in `<mj-attributes>`; absent for page-only styles. */
  readonly mjml?: readonly MjmlTarget[];
  readonly kinds?: readonly DocumentKind[];
}

export interface StyleGroupSpec {
  readonly group: string;
  readonly labelKey: string;
  readonly keys: readonly StyleKeySpec[];
}

/** `group.key` of a global style, the path a block field inherits from. */
export type StylePath = `${string}.${string}`;

const color: ValueSpec = { type: 'color' };
const pixels = (max: number): ValueSpec => ({ type: 'length', units: ['px'], max });
const fontWeights = [
  { value: '400', labelKey: 'properties.weightNormal' },
  { value: '500', labelKey: 'properties.weightMedium' },
  { value: '600', labelKey: 'properties.weightSemibold' },
  { value: '700', labelKey: 'properties.weightBold' },
] as const;
const weight: ValueSpec = { type: 'select', options: fontWeights.map((entry) => entry.value) };
const fontFamily: ValueSpec = { type: 'fontFamily' };

/**
 * The global styles of a piece and their catalog defaults. A piece stores only what differs;
 * "restore default" removes the key. Labels are keys of the package catalogs.
 */
export const GLOBAL_STYLE_GROUPS: readonly StyleGroupSpec[] = Object.freeze([
  {
    group: 'body',
    labelKey: 'blockStyles.body',
    keys: [
      {
        key: 'background',
        labelKey: 'blockStyles.pageBackground',
        control: 'color',
        value: color,
        default: '#f3f7f6',
      },
      {
        key: 'contentBackground',
        labelKey: 'blockStyles.contentBackground',
        control: 'color',
        value: color,
        default: '#ffffff',
        mjml: [{ element: 'mj-section', attribute: 'background-color' }],
      },
      {
        key: 'width',
        labelKey: 'blockStyles.contentWidth',
        control: 'length',
        value: pixels(1_600),
        default: { email: '600px', page: '1120px' },
      },
      {
        key: 'fontFamily',
        labelKey: 'properties.fontFamily',
        control: 'select',
        value: fontFamily,
        default: 'Arial, Helvetica, sans-serif',
        options: FONT_STACKS,
        mjml: [{ element: 'mj-all', attribute: 'font-family' }],
      },
      {
        key: 'textColor',
        labelKey: 'properties.color',
        control: 'color',
        value: color,
        default: '#243746',
        mjml: [{ element: 'mj-text', attribute: 'color' }],
      },
      {
        key: 'fontSize',
        labelKey: 'properties.fontSize',
        control: 'length',
        value: pixels(96),
        default: '16px',
        mjml: [{ element: 'mj-text', attribute: 'font-size' }],
      },
      {
        key: 'lineHeight',
        labelKey: 'properties.lineHeight',
        control: 'length',
        value: { type: 'ratio' },
        default: '1.65',
        mjml: [{ element: 'mj-text', attribute: 'line-height' }],
      },
      {
        key: 'linkColor',
        labelKey: 'blockStyles.linkColor',
        control: 'color',
        value: color,
        default: '#0d766e',
      },
    ],
  },
  {
    group: 'heading',
    labelKey: 'blockStyles.heading',
    keys: [
      {
        key: 'fontFamily',
        labelKey: 'properties.fontFamily',
        control: 'select',
        value: fontFamily,
        default: 'Arial, Helvetica, sans-serif',
        options: FONT_STACKS,
        mjml: [{ element: 'mj-text', mjClass: 've-heading', attribute: 'font-family' }],
      },
      {
        key: 'color',
        labelKey: 'properties.color',
        control: 'color',
        value: color,
        default: '#10302c',
        mjml: [{ element: 'mj-text', mjClass: 've-heading', attribute: 'color' }],
      },
      {
        key: 'fontSize',
        labelKey: 'properties.fontSize',
        control: 'length',
        value: pixels(160),
        default: '28px',
        mjml: [{ element: 'mj-text', mjClass: 've-heading', attribute: 'font-size' }],
      },
      {
        key: 'fontWeight',
        labelKey: 'properties.fontWeight',
        control: 'select',
        value: weight,
        default: '700',
        options: fontWeights,
        mjml: [{ element: 'mj-text', mjClass: 've-heading', attribute: 'font-weight' }],
      },
      {
        key: 'lineHeight',
        labelKey: 'properties.lineHeight',
        control: 'length',
        value: { type: 'ratio' },
        default: '1.25',
        mjml: [{ element: 'mj-text', mjClass: 've-heading', attribute: 'line-height' }],
      },
    ],
  },
  {
    group: 'button',
    labelKey: 'blockStyles.button',
    keys: [
      {
        key: 'background',
        labelKey: 'properties.background',
        control: 'color',
        value: color,
        default: '#0d766e',
        mjml: [{ element: 'mj-button', attribute: 'background-color' }],
      },
      {
        key: 'color',
        labelKey: 'properties.color',
        control: 'color',
        value: color,
        default: '#ffffff',
        mjml: [{ element: 'mj-button', attribute: 'color' }],
      },
      {
        key: 'radius',
        labelKey: 'properties.borderRadius',
        control: 'length',
        value: pixels(64),
        default: '8px',
        mjml: [{ element: 'mj-button', attribute: 'border-radius' }],
      },
      {
        key: 'fontSize',
        labelKey: 'properties.fontSize',
        control: 'length',
        value: pixels(64),
        default: '16px',
        mjml: [{ element: 'mj-button', attribute: 'font-size' }],
      },
      {
        key: 'fontWeight',
        labelKey: 'properties.fontWeight',
        control: 'select',
        value: weight,
        default: '600',
        options: fontWeights,
        mjml: [{ element: 'mj-button', attribute: 'font-weight' }],
      },
      {
        key: 'padding',
        labelKey: 'properties.padding',
        control: 'length',
        value: { type: 'box' },
        default: '12px 24px',
        mjml: [{ element: 'mj-button', attribute: 'inner-padding' }],
      },
    ],
  },
  {
    group: 'divider',
    labelKey: 'blocks.divider',
    keys: [
      {
        key: 'color',
        labelKey: 'properties.borderColor',
        control: 'color',
        value: color,
        default: '#dce4e7',
        mjml: [{ element: 'mj-divider', attribute: 'border-color' }],
      },
      {
        key: 'width',
        labelKey: 'properties.borderWidth',
        control: 'length',
        value: pixels(16),
        default: '1px',
        mjml: [{ element: 'mj-divider', attribute: 'border-width' }],
      },
    ],
  },
  {
    group: 'footer',
    labelKey: 'blocks.footer',
    keys: [
      {
        key: 'color',
        labelKey: 'properties.color',
        control: 'color',
        value: color,
        default: '#536674',
        mjml: [{ element: 'mj-text', mjClass: 've-footer', attribute: 'color' }],
      },
      {
        key: 'fontSize',
        labelKey: 'properties.fontSize',
        control: 'length',
        value: pixels(48),
        default: '12px',
        mjml: [{ element: 'mj-text', mjClass: 've-footer', attribute: 'font-size' }],
      },
    ],
  },
  {
    group: 'section',
    labelKey: 'blocks.section',
    keys: [
      {
        key: 'padding',
        labelKey: 'properties.padding',
        control: 'length',
        value: { type: 'box' },
        default: '24px 0',
        mjml: [{ element: 'mj-section', attribute: 'padding' }],
      },
      {
        key: 'columnGap',
        labelKey: 'properties.columnGap',
        control: 'length',
        value: pixels(160),
        default: '24px',
        kinds: ['page'],
      },
    ],
  },
]);

export class GlobalStyleSpec {
  readonly #keys = new Map<StylePath, StyleKeySpec>();

  constructor(readonly groups: readonly StyleGroupSpec[] = GLOBAL_STYLE_GROUPS) {
    for (const group of groups)
      for (const key of group.keys) this.#keys.set(`${group.group}.${key.key}`, key);
  }

  key(group: string, key: string): StyleKeySpec | undefined {
    return this.#keys.get(`${group}.${key}`);
  }

  has(path: string): path is StylePath {
    return this.#keys.has(path as StylePath);
  }

  paths(): readonly StylePath[] {
    return [...this.#keys.keys()];
  }

  defaultOf(path: StylePath, kind: DocumentKind): string {
    const spec = this.#keys.get(path);
    if (!spec) throw new Error('UNKNOWN_STYLE');
    return typeof spec.default === 'string' ? spec.default : spec.default[kind];
  }
}

/** The effective value of every global style: the piece's override, or the catalog default. */
export class StyleResolver {
  constructor(
    private readonly spec: GlobalStyleSpec,
    private readonly styles: GlobalStyles,
    private readonly kind: DocumentKind,
  ) {}

  value(path: StylePath): string {
    const [group = '', key = ''] = path.split('.');
    const own: StyleValue | undefined = this.styles[group]?.[key];
    return own !== undefined ? String(own) : this.spec.defaultOf(path, this.kind);
  }

  /** Whether the piece overrides this style; false means the catalog default applies. */
  overridden(path: StylePath): boolean {
    const [group = '', key = ''] = path.split('.');
    return this.styles[group]?.[key] !== undefined;
  }
}
