<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { CSSProperties } from 'vue';
import EditorMenu from './EditorMenu.vue';
import type { EditorMenuItem } from './EditorMenu.vue';

export interface MenuAnchor {
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
}

const props = withDefaults(
  defineProps<{
    /** Where the menu opens, in viewport coordinates; undefined keeps it closed. */
    anchor: MenuAnchor | undefined;
    items: readonly EditorMenuItem[];
    label: string;
    filter?: boolean;
    filterPlaceholder?: string;
    emptyText?: string;
    /**
     * The keyboard moves into the menu as it opens: to its search field, or to its first item.
     * A menu opened from inside the frame of the piece cannot rely on the primitive for it,
     * which only sees the keys pressed in this document.
     */
    autofocus?: boolean;
  }>(),
  { filter: false, filterPlaceholder: '', emptyText: '', autofocus: false },
);
const emit = defineEmits<{ select: [id: string]; close: [] }>();
const trigger = ref<HTMLElement>();
/** The open list, found through its trigger: the primitive names one by the other. */
const content = (): HTMLElement | null => {
  const id = trigger.value?.id;
  return id ? document.querySelector<HTMLElement>(`[aria-labelledby="${CSS.escape(id)}"]`) : null;
};
const FOCUS_ATTEMPTS = 20;
const focusInside = async (): Promise<void> => {
  await nextTick();
  // The primitive may focus its own list a moment later: the keyboard is settled once an item
  // of the list has kept it for two frames in a row.
  let settled = 0;
  for (let attempt = 0; attempt < FOCUS_ATTEMPTS && props.anchor && settled < 2; attempt++) {
    const list = content();
    const active = document.activeElement;
    if (list && active && active !== list && list.contains(active)) settled++;
    else {
      settled = 0;
      const target =
        list?.querySelector<HTMLElement>('input') ??
        list?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])');
      target?.focus({ preventScroll: true });
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
};
watch(
  () => props.anchor,
  (anchor, previous) => {
    if (anchor && !previous && props.autofocus) void focusInside();
  },
);
const style = computed<CSSProperties>(() => ({
  left: `${props.anchor?.x ?? 0}px`,
  top: `${props.anchor?.y ?? 0}px`,
  width: `${Math.max(1, props.anchor?.width ?? 1)}px`,
  height: `${Math.max(1, props.anchor?.height ?? 1)}px`,
}));
</script>

<template>
  <EditorMenu
    :open="!!anchor"
    :items="items"
    :label="label"
    :filter="filter"
    :filter-placeholder="filterPlaceholder"
    @select="emit('select', $event)"
    @update:open="
      (open) => {
        if (!open) emit('close');
      }
    "
  >
    <span ref="trigger" class="editor-menu-anchor" :style="style" :aria-label="label" />
    <template #empty>{{ emptyText }}</template>
  </EditorMenu>
</template>
