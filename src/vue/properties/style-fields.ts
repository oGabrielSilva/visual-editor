/** One row of the Style tab: which control edits which CSS property, and under which heading. */
export type StyleGroup = 'typography' | 'appearance' | 'layout' | 'borders';

export interface ChoiceField {
  readonly name: string;
  readonly label: string;
  /** Pairs of CSS value and catalog key. */
  readonly options: readonly (readonly [string, string])[];
}

export interface MeasureField {
  readonly name: string;
  readonly label: string;
  readonly minimum: number;
  readonly units: readonly string[];
}

export interface ColorField {
  readonly name: string;
  readonly label: string;
}

const LENGTH = ['px', 'rem', 'em', '%'] as const;
const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const SIDE_LABEL = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' } as const;

export const STYLE_GROUPS: readonly {
  readonly id: StyleGroup;
  readonly label: string;
  readonly open: boolean;
}[] = [
  { id: 'typography', label: 'properties.typography', open: true },
  { id: 'appearance', label: 'properties.appearance', open: true },
  { id: 'layout', label: 'properties.dimensions', open: false },
  { id: 'borders', label: 'properties.borders', open: false },
];

export const CHOICE_FIELDS: readonly ChoiceField[] = [
  {
    name: 'font-family',
    label: 'properties.fontFamily',
    options: [
      ['Arial, sans-serif', 'properties.fontSans'],
      ['Georgia, serif', 'properties.fontSerif'],
      ['monospace', 'properties.fontMonospace'],
    ],
  },
  {
    name: 'font-weight',
    label: 'properties.fontWeight',
    options: [
      ['400', 'properties.weightNormal'],
      ['500', 'properties.weightMedium'],
      ['600', 'properties.weightSemibold'],
      ['700', 'properties.weightBold'],
    ],
  },
  {
    name: 'text-align',
    label: 'properties.textAlign',
    options: [
      ['left', 'properties.alignLeft'],
      ['center', 'properties.alignCenter'],
      ['right', 'properties.alignRight'],
      ['justify', 'properties.alignJustify'],
    ],
  },
  {
    name: 'object-fit',
    label: 'properties.imageFit',
    options: [
      ['contain', 'properties.imageContain'],
      ['cover', 'properties.imageCover'],
      ['fill', 'properties.imageFill'],
      ['none', 'properties.imageOriginal'],
      ['scale-down', 'properties.imageReduce'],
    ],
  },
  {
    name: 'border-style',
    label: 'properties.borderStyle',
    options: [
      ['none', 'properties.borderNone'],
      ['solid', 'properties.borderSolid'],
      ['dashed', 'properties.borderDashed'],
      ['dotted', 'properties.borderDotted'],
      ['double', 'properties.borderDouble'],
    ],
  },
  {
    name: 'grid-template-columns',
    label: 'properties.columns',
    options: [
      ['1fr', 'properties.oneColumn'],
      ['1fr 1fr', 'properties.twoColumns'],
      ['1fr 1fr 1fr', 'properties.threeColumns'],
      ['2fr 1fr', 'properties.widerLeft'],
      ['1fr 2fr', 'properties.widerRight'],
    ],
  },
  {
    name: 'align-items',
    label: 'properties.alignItems',
    options: [
      ['start', 'properties.alignStart'],
      ['center', 'properties.alignCenter'],
      ['end', 'properties.alignEnd'],
      ['stretch', 'properties.alignStretch'],
    ],
  },
  {
    name: 'justify-content',
    label: 'properties.justifyContent',
    options: [
      ['start', 'properties.alignStart'],
      ['center', 'properties.alignCenter'],
      ['end', 'properties.alignEnd'],
      ['space-between', 'properties.spaceBetween'],
      ['space-around', 'properties.spaceAround'],
      ['space-evenly', 'properties.spaceEvenly'],
    ],
  },
];

const sides = (property: 'padding' | 'margin', minimum: number): MeasureField[] => [
  { name: property, label: `properties.${property}`, minimum, units: LENGTH },
  ...SIDES.map((side) => ({
    name: `${property}-${side}`,
    label: `properties.${property}${SIDE_LABEL[side]}`,
    minimum,
    units: LENGTH,
  })),
];

export const MEASURE_FIELDS: readonly MeasureField[] = [
  { name: 'font-size', label: 'properties.fontSize', minimum: 0, units: LENGTH },
  { name: 'line-height', label: 'properties.lineHeight', minimum: 0, units: ['', ...LENGTH] },
  { name: 'letter-spacing', label: 'properties.letterSpacing', minimum: -100, units: ['px', 'em'] },
  { name: 'width', label: 'properties.width', minimum: 0, units: ['px', '%', 'rem', 'em'] },
  { name: 'max-width', label: 'properties.maxWidth', minimum: 0, units: ['px', '%', 'rem', 'em'] },
  { name: 'height', label: 'properties.height', minimum: 0, units: ['px', '%', 'rem', 'em'] },
  ...sides('padding', 0),
  ...sides('margin', -10000),
  { name: 'border-width', label: 'properties.borderWidth', minimum: 0, units: ['px', 'rem', 'em'] },
  { name: 'border-radius', label: 'properties.borderRadius', minimum: 0, units: LENGTH },
  { name: 'gap', label: 'properties.gap', minimum: 0, units: LENGTH },
  { name: 'column-gap', label: 'properties.columnGap', minimum: 0, units: LENGTH },
  { name: 'row-gap', label: 'properties.rowGap', minimum: 0, units: LENGTH },
];

export const COLOR_FIELDS: readonly ColorField[] = [
  { name: 'color', label: 'properties.color' },
  { name: 'background-color', label: 'properties.background' },
  { name: 'border-color', label: 'properties.borderColor' },
];

/** The heading a CSS property belongs to in the Style tab. */
export function styleGroup(name: string): StyleGroup {
  if (
    name.startsWith('font-') ||
    name === 'text-align' ||
    name === 'line-height' ||
    name === 'letter-spacing'
  )
    return 'typography';
  if (name.startsWith('border-')) return 'borders';
  if (name === 'color' || name === 'background-color') return 'appearance';
  return 'layout';
}

/** Layout of a grid only exists in pages; an e-mail keeps its table structure. */
export const PAGE_ONLY_STYLES: readonly string[] = [
  'grid-template-columns',
  'align-items',
  'justify-content',
];
