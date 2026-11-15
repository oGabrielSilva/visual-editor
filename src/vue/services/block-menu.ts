import type { BlockCommandItem } from './block-command-definitions';

export interface BlockMenuEntry {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly group: number;
  readonly disabled: boolean;
  readonly danger?: boolean;
  readonly kbds?: readonly string[];
}

/** The commands of a block as menu entries: one shape for the piece and for the tree. */
export function blockMenuItems(
  items: readonly BlockCommandItem[],
  text: (key: string) => string,
): BlockMenuEntry[] {
  return items.map((item) => ({
    id: item.name,
    label: text(item.labelKey),
    icon: item.icon,
    group: item.group,
    disabled: !item.enabled,
    ...(item.danger ? { danger: true } : {}),
    ...(item.keys ? { kbds: item.keys } : {}),
  }));
}
