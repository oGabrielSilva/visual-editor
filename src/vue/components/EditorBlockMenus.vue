<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWorkbench } from '../workbench';
import { BlockPalette } from '../services/block-palette';
import type { BlockCommandName } from '../services/block-command-definitions';
import { blockMenuItems } from '../services/block-menu';
import EditorAnchoredMenu from './ui/EditorAnchoredMenu.vue';
import type { EditorMenuItem } from './ui/EditorMenu.vue';

/**
 * The two menus a block can open anywhere in the shell: its actions, at the point where the
 * secondary button was pressed, and the block picker, next to the block which asked for it.
 */
const workbench = useWorkbench();
const { state, commands } = workbench;
const t = workbench.t;
/** Where the chosen block lands, relative to the block which asked; the person may change it. */
const placement = ref<'before' | 'after' | 'inside'>('after');
const palette = computed(() => new BlockPalette(t));
const request = computed(() => commands.insertion.value);
const container = computed(() => {
  const id = request.value?.targetId;
  return !!id && !!workbench.controller().resolveSelection(id)?.container;
});
watch(request, (value) => {
  placement.value = value?.placement ?? 'after';
});
const fallbackAnchor = (): { x: number; y: number } => ({
  x: Math.round(window.innerWidth / 2),
  y: Math.round(window.innerHeight / 3),
});
const pickerAnchor = computed(() =>
  request.value ? (request.value.anchor ?? fallbackAnchor()) : undefined,
);
const pickerItems = computed<EditorMenuItem[]>(() => {
  if (!request.value) return [];
  // Before, after and, in a container, inside: one choice, kept while the menu is open.
  const places = (['before', 'after', 'inside'] as const).filter(
    (value) => value !== 'inside' || container.value,
  );
  const where: EditorMenuItem[] = places.map((value) => ({
    id: `placement:${value}`,
    label: t(PLACEMENT_LABELS[value]),
    checked: placement.value === value,
    radio: true,
    group: 'placement',
  }));
  const blocks = palette.value
    .groups(workbench.controller().blocks(state.value.document.kind))
    .flatMap((group) => [
      { id: `heading:${group.category}`, label: group.label, heading: true, group: group.category },
      ...group.blocks.map((block) => ({
        id: `block:${block.type}`,
        label: block.label,
        icon: block.icon,
        group: group.category,
      })),
    ]);
  return [...where, ...blocks];
});
const PLACEMENT_LABELS = {
  before: 'canvas.insertBefore',
  after: 'canvas.insertAfter',
  inside: 'canvas.insertInside',
} as const;
/** Set when a choice closes a menu, so the close is not taken as a dismissal. */
let chosen = false;
const pick = (id: string): void => {
  const current = request.value;
  if (!current) return;
  if (id.startsWith('placement:')) {
    const value = id.slice('placement:'.length);
    if (value === 'before' || value === 'after' || value === 'inside') placement.value = value;
    return;
  }
  if (!id.startsWith('block:')) return;
  chosen = true;
  const where = placement.value === 'inside' && !container.value ? 'after' : placement.value;
  workbench.busy.value = true;
  void commands
    .insert(id.slice('block:'.length), { targetId: current.targetId, placement: where })
    .finally(() => {
      workbench.busy.value = false;
      // Inserting keeps the selection: the keyboard continues from the block which asked.
      if (current.keyboard) current.returnFocus?.();
    });
};
const closePicker = (): void => {
  const current = request.value;
  commands.cancelInsertion();
  if (!chosen && current) {
    commands.dismissed();
    if (current.keyboard) current.returnFocus?.();
  }
  chosen = false;
};
const menuItems = computed(() => blockMenuItems(commands.items(commands.menu.value?.targetId), t));
/** Commands which leave the keyboard nowhere else: it returns to the block in the piece. */
const RETURNING: readonly string[] = [
  'selectParent',
  'duplicate',
  'moveUp',
  'moveDown',
  'copy',
  'paste',
];
/** Commands which open another layer: it takes the keyboard back to the piece when done. */
const HANDING_OVER: readonly string[] = ['insertBefore', 'insertAfter', 'insertInside', 'remove'];
const runMenu = (name: string): void => {
  const current = commands.menu.value;
  chosen = true;
  commands.closeMenu();
  if (!current) return;
  const origin =
    current.keyboard && HANDING_OVER.includes(name)
      ? {
          keyboard: true,
          ...(current.returnFocus ? { returnFocus: current.returnFocus } : {}),
        }
      : {};
  void commands.run(name as BlockCommandName, current.targetId, current.anchor, origin).then(() => {
    if (current.keyboard && RETURNING.includes(name)) current.returnFocus?.();
  });
};
const closeMenu = (): void => {
  const current = commands.menu.value;
  commands.closeMenu();
  if (!chosen && current) {
    commands.dismissed();
    // Only a menu of the keyboard gives the keyboard back; a mouse leaves it where it is.
    if (current.keyboard) current.returnFocus?.();
  }
  chosen = false;
};
</script>

<template>
  <EditorAnchoredMenu
    :anchor="commands.menu.value?.anchor"
    :items="menuItems"
    :label="t('canvas.blockMenu')"
    :autofocus="!!commands.menu.value?.keyboard"
    @select="runMenu"
    @close="closeMenu"
  />
  <EditorAnchoredMenu
    :anchor="pickerAnchor"
    :items="pickerItems"
    :label="t('canvas.add')"
    filter
    :filter-placeholder="t('palette.search')"
    :empty-text="t('palette.empty')"
    :autofocus="!!request?.keyboard"
    @select="pick"
    @close="closePicker"
  />
</template>
