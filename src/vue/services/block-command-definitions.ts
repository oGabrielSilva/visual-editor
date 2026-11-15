export const BLOCK_COMMANDS = [
  'editText',
  'selectParent',
  'insertBefore',
  'insertAfter',
  'insertInside',
  'duplicate',
  'moveUp',
  'moveDown',
  'editHtml',
  'replaceImage',
  'copy',
  'paste',
  'remove',
] as const;

export type BlockCommandName = (typeof BLOCK_COMMANDS)[number];

export interface BlockCommandItem {
  readonly name: BlockCommandName;
  readonly labelKey: string;
  readonly icon: string;
  /** Position of a separator: items of one group stay together. */
  readonly group: number;
  readonly enabled: boolean;
  readonly danger?: boolean;
  readonly keys?: readonly string[];
}

/** The commands of a block in menu order, with their label, icon, group and keys. */
export const BLOCK_COMMAND_DEFINITIONS: readonly Omit<BlockCommandItem, 'enabled'>[] = [
  { name: 'editText', labelKey: 'canvas.edit', icon: 'i-lucide-square-pen', group: 0 },
  {
    name: 'selectParent',
    labelKey: 'canvas.parent',
    icon: 'i-lucide-corner-left-up',
    group: 0,
    keys: ['Esc'],
  },
  {
    name: 'insertBefore',
    labelKey: 'canvas.insertBefore',
    icon: 'i-lucide-arrow-up-to-line',
    group: 1,
  },
  {
    name: 'insertAfter',
    labelKey: 'canvas.insertAfter',
    icon: 'i-lucide-arrow-down-to-line',
    group: 1,
  },
  { name: 'insertInside', labelKey: 'canvas.insertInside', icon: 'i-lucide-square-plus', group: 1 },
  {
    name: 'duplicate',
    labelKey: 'canvas.duplicate',
    icon: 'i-lucide-copy',
    group: 2,
    keys: ['meta', 'D'],
  },
  {
    name: 'moveUp',
    labelKey: 'canvas.up',
    icon: 'i-lucide-arrow-up',
    group: 2,
    keys: ['alt', '↑'],
  },
  {
    name: 'moveDown',
    labelKey: 'canvas.down',
    icon: 'i-lucide-arrow-down',
    group: 2,
    keys: ['alt', '↓'],
  },
  { name: 'editHtml', labelKey: 'canvas.editHtml', icon: 'i-lucide-code-xml', group: 3 },
  { name: 'replaceImage', labelKey: 'actions.replaceImage', icon: 'i-lucide-image', group: 3 },
  { name: 'copy', labelKey: 'canvas.copy', icon: 'i-lucide-clipboard-copy', group: 4 },
  { name: 'paste', labelKey: 'canvas.paste', icon: 'i-lucide-clipboard-paste', group: 4 },
  {
    name: 'remove',
    labelKey: 'canvas.remove',
    icon: 'i-lucide-trash-2',
    group: 5,
    danger: true,
    keys: ['Delete'],
  },
];
