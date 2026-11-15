<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { CSSProperties } from 'vue';
import type { CanvasPlacement } from '../../core/canvas-layout';
import { documentProjectionKey } from '../projection-key';
import { useWorkbench } from '../workbench';
import { StructureTree } from '../services/structure-tree';
import { TreeDragSession } from '../services/tree-drag';
import { blockMenuItems } from '../services/block-menu';
import type { BlockCommandName } from '../services/block-command-definitions';
import EditorTree from './ui/EditorTree.vue';
import EditorContextMenu from './ui/EditorContextMenu.vue';
import EditorEmpty from './ui/EditorEmpty.vue';

/**
 * The hierarchy of the piece. It follows the selection in both directions, shows in the piece the
 * row under the pointer, and moves a block before, after or into another one.
 */
const VIRTUALIZE_FROM = 200;
const workbench = useWorkbench();
const { state, commands } = workbench;
const t = workbench.t;
const root = ref<HTMLElement>();
const tree = computed(() => new StructureTree(t));
const nodes = computed(() => {
  void documentProjectionKey(state.value);
  const controller = workbench.controller();
  return tree.value.build(controller.canvasRegions(), controller.entries());
});
const count = computed(() => tree.value.count(nodes.value));
const expanded = ref<string[]>([]);
const menuId = ref<string>();
const drop = ref<{ id: string; placement: CanvasPlacement; style: CSSProperties }>();
const drag = new TreeDragSession();
let capture: number | undefined;
let ignoreClick = false;
let menuAnchor: { x: number; y: number; width: number; height: number } | undefined;
let scrollTimer = 0;
let known = new Set<string>();
watch(
  nodes,
  (list) => {
    const current = new Set<string>();
    const walk = (items: typeof list): void => {
      for (const item of items) {
        current.add(item.id);
        if (item.children) walk(item.children as typeof list);
      }
    };
    walk(list);
    // What the person folded or opened is kept; blocks which are new start from the default.
    const fresh = tree.value.defaultExpanded(list).filter((id) => !known.has(id));
    expanded.value = [...expanded.value.filter((id) => current.has(id)), ...fresh];
    known = current;
  },
  { immediate: true },
);
watch(
  [() => state.value.selectedNodeId, nodes],
  ([id]) => {
    if (!id) return;
    // The selected block is always reachable: its ancestors open.
    const missing = tree.value
      .path(nodes.value, id)
      .filter((entry) => !expanded.value.includes(entry));
    if (missing.length) expanded.value = [...expanded.value, ...missing];
  },
  { immediate: true },
);
const row = (target: EventTarget | null): { id: string; element: HTMLElement } | undefined => {
  const element =
    target instanceof Element ? target.closest<HTMLElement>('[data-slot="link"]') : undefined;
  const id = element?.querySelector<HTMLElement>('[data-editor-node-id]')?.dataset.editorNodeId;
  return element && id && root.value?.contains(element) ? { id, element } : undefined;
};
const stopScroll = (): void => {
  if (scrollTimer) cancelAnimationFrame(scrollTimer);
  scrollTimer = 0;
};
const cancel = (): void => {
  drag.cancel();
  drop.value = undefined;
  stopScroll();
  if (capture !== undefined && root.value?.hasPointerCapture(capture))
    root.value.releasePointerCapture(capture);
  capture = undefined;
};
const start = (event: PointerEvent): void => {
  const target = row(event.target);
  // Touch scrolls the tree; its rows are moved with the commands of their menu.
  if (!target || state.value.readOnly || event.pointerType === 'touch' || capture !== undefined)
    return;
  if (drag.start(target.id, event)) ignoreClick = false;
};
const autoScroll = (y: number): void => {
  const scroller = root.value?.closest<HTMLElement>('.editor-scroll');
  stopScroll();
  if (!scroller) return;
  const bounds = scroller.getBoundingClientRect();
  const speed = y < bounds.top + 28 ? -10 : y > bounds.bottom - 28 ? 10 : 0;
  if (!speed) return;
  const step = (): void => {
    scroller.scrollBy(0, speed);
    scrollTimer = requestAnimationFrame(step);
  };
  scrollTimer = requestAnimationFrame(step);
};
const move = (event: PointerEvent): void => {
  const sourceId = drag.sourceId;
  if (!sourceId) return;
  const under = row(
    root.value?.ownerDocument.elementFromPoint(event.clientX, event.clientY) ?? null,
  );
  let target: { id: string; placement: CanvasPlacement } | undefined;
  let bounds: DOMRect | undefined;
  if (under && under.id !== sourceId) {
    bounds = under.element.getBoundingClientRect();
    const placement = tree.value.placement(
      workbench.controller().movementTargets(sourceId),
      under.id,
      bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0,
      !!tree.value.find(nodes.value, under.id)?.container,
    );
    if (placement) target = { id: under.id, placement };
  }
  if (!drag.update(event, target)) return;
  event.preventDefault();
  ignoreClick = true;
  if (capture === undefined && root.value) {
    try {
      root.value.setPointerCapture(event.pointerId);
      capture = event.pointerId;
    } catch {
      cancel();
      return;
    }
  }
  autoScroll(event.clientY);
  const origin = root.value?.getBoundingClientRect();
  drop.value =
    target && bounds && origin
      ? {
          ...target,
          style: {
            left: `${bounds.left - origin.left}px`,
            width: `${bounds.width}px`,
            top: `${(target.placement === 'after' ? bounds.bottom : bounds.top) - origin.top}px`,
            height: target.placement === 'inside' ? `${bounds.height}px` : '2px',
          },
        }
      : undefined;
};
const finish = (event: PointerEvent): void => {
  const result = drag.finish(event);
  cancel();
  if (result && !state.value.readOnly)
    void commands.move(result.source, result.target, result.placement);
  setTimeout(() => {
    ignoreClick = false;
  }, 0);
};
const key = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' && drag.dragging) {
    event.preventDefault();
    event.stopPropagation();
    ignoreClick = true;
    cancel();
    return;
  }
  // The tree moves its own focus with the arrows; the shortcuts of the shell come first.
  if (workbench.shortcuts.handle(event)) event.stopPropagation();
};
const hover = (event: PointerEvent): void => {
  if (!drag.dragging) workbench.canvas.value?.hover(row(event.target)?.id);
};
const context = (event: MouseEvent): void => {
  const target = row(event.target);
  if (!target) {
    // Outside a row there is nothing to act on: the menu of the browser stays out as well.
    event.preventDefault();
    event.stopPropagation();
    menuId.value = undefined;
    return;
  }
  const bounds = target.element.getBoundingClientRect();
  menuAnchor = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  menuId.value = target.id;
  void workbench.select(target.id);
};
const menuItems = computed(() => blockMenuItems(commands.items(menuId.value), t));
const runMenu = (name: string): void => {
  if (menuId.value) void commands.run(name as BlockCommandName, menuId.value, menuAnchor);
};
watch(() => state.value.readOnly, cancel);
onBeforeUnmount(() => {
  cancel();
  workbench.canvas.value?.hover(undefined);
});
</script>

<template>
  <EditorEmpty
    v-if="!nodes.length"
    icon="i-lucide-list-tree"
    :title="t('structure.empty')"
    :description="t('editor.empty')"
  />
  <EditorContextMenu v-else :items="menuItems" :label="t('canvas.blockMenu')" @select="runMenu">
    <div
      ref="root"
      class="editor-structure"
      :class="{ 'is-dragging': !!drop, 'is-virtual': count > VIRTUALIZE_FROM }"
      @pointerdown="start"
      @pointermove="move"
      @pointerup="finish"
      @pointercancel="cancel"
      @lostpointercapture="cancel"
      @pointerover="hover"
      @pointerleave="workbench.canvas.value?.hover(undefined)"
      @contextmenu.capture="context"
      @keydown.capture="key"
    >
      <EditorTree
        :items="nodes"
        :selected-id="state.selectedNodeId"
        :expanded="expanded"
        :label="t('editor.structure')"
        :virtualize="count > VIRTUALIZE_FROM"
        :suppress-click="() => ignoreClick"
        @select="workbench.select($event)"
        @update:expanded="expanded = $event"
      />
      <div
        v-if="drop"
        class="editor-structure-drop"
        :class="`is-${drop.placement}`"
        :style="drop.style"
        aria-hidden="true"
      />
    </div>
  </EditorContextMenu>
</template>
