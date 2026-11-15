<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import USlideover from '@nuxt/ui/components/Slideover.vue';
import EditorButton from './EditorButton.vue';
import { EDITOR_PANEL_MEDIA_QUERY } from '../../responsive-panel';
import { EditorDialogFocus } from './editor-dialog-focus';
import { preserveComposingEscape } from './composition-dismissal';

const props = defineProps<{
  id: string;
  open: boolean;
  mobile: boolean;
  label: string;
  closeLabel: string;
  returnFocus?: HTMLElement | undefined;
  side?: 'left' | 'right';
}>();
const emit = defineEmits<{ 'update:open': [open: boolean] }>();
const destination = ref<HTMLElement>();
const desktop = ref<HTMLElement>();
const active = computed(() => props.mobile && props.open);
const focus = new EditorDialogFocus();
let dialog: HTMLElement | undefined;
let rememberedFocus: HTMLElement | undefined;
let panelMedia: MediaQueryList | undefined;
let responsiveFocus:
  | { mobile: boolean; generation: number; focused: HTMLElement; wasDialogControl: boolean }
  | undefined;
let focusGeneration = 0;
let movingFocus = false;
const owns = (node: Node): boolean =>
  !!(desktop.value?.contains(node) || destination.value?.contains(node) || dialog?.contains(node));
const invalidateFocus = (): void => {
  rememberedFocus = undefined;
  responsiveFocus = undefined;
  focusGeneration++;
};
const rememberFocus = (event: FocusEvent): void => {
  if (event.target instanceof HTMLElement && owns(event.target)) rememberedFocus = event.target;
  else invalidateFocus();
};
const releaseFocus = (event: FocusEvent): void => {
  if (!(event.target instanceof HTMLElement) || !owns(event.target)) return;
  const mobile = panelMedia?.matches;
  if (
    rememberedFocus === event.target &&
    mobile !== undefined &&
    mobile !== props.mobile &&
    (!(event.relatedTarget instanceof Node) ||
      event.relatedTarget === document.body ||
      owns(event.relatedTarget))
  ) {
    responsiveFocus = {
      mobile,
      generation: focusGeneration,
      focused: event.target,
      wasDialogControl: !!dialog?.contains(event.target),
    };
    return;
  }
  if (event.relatedTarget instanceof Node) {
    if (!owns(event.relatedTarget) && (event.relatedTarget !== document.body || !movingFocus))
      invalidateFocus();
  } else if (!movingFocus && event.target.getClientRects().length) invalidateFocus();
};
const outsidePointer = (event: PointerEvent): void => {
  if (!(event.target instanceof Node) || !owns(event.target)) invalidateFocus();
};
const desktopFocusTarget = (preferred?: HTMLElement): HTMLElement | undefined => {
  if (
    preferred?.isConnected &&
    desktop.value?.contains(preferred) &&
    preferred.getClientRects().length
  )
    return preferred;
  return (
    desktop.value?.querySelector<HTMLElement>('button[aria-pressed="true"]:not(:disabled)') ??
    desktop.value?.querySelector<HTMLElement>('button:not(:disabled)') ??
    undefined
  );
};
const content = computed(() => ({
  onEscapeKeyDown: preserveComposingEscape,
  id: props.id,
  onOpenAutoFocus: (event: Event): void => {
    dialog = event.target instanceof HTMLElement ? event.target : undefined;
    focus.open(event);
  },
  onCloseAutoFocus: (event: Event): void => {
    event.preventDefault();
    if (props.mobile) focus.close(event, props.returnFocus);
    else {
      const active = document.activeElement;
      if (
        (active instanceof HTMLElement && owns(active)) ||
        (active === document.body && rememberedFocus && owns(rememberedFocus))
      )
        focus.close(event, desktopFocusTarget(rememberedFocus));
    }
    dialog = undefined;
  },
}));
watch(
  () => props.mobile,
  async (mobile) => {
    const pending = responsiveFocus;
    responsiveFocus = undefined;
    const transfer =
      pending?.mobile === mobile && pending.generation === focusGeneration ? pending : undefined;
    const active = document.activeElement;
    const focused =
      active instanceof HTMLElement && owns(active)
        ? active
        : active === document.body
          ? (transfer?.focused ?? rememberedFocus)
          : undefined;
    if (!focused || (!transfer && (!focused.isConnected || !owns(focused)))) return;
    const wasDialogControl = transfer?.wasDialogControl ?? !!dialog?.contains(focused);
    const generation = focusGeneration;
    movingFocus = true;
    await nextTick();
    movingFocus = false;
    const activeElement = document.activeElement;
    if (
      generation !== focusGeneration ||
      props.mobile !== mobile ||
      (activeElement !== focused && activeElement !== document.body)
    )
      return;
    const target = mobile
      ? props.returnFocus
      : focused.isConnected && focused.getClientRects().length
        ? focused
        : wasDialogControl
          ? desktopFocusTarget()
          : undefined;
    if (target?.isConnected && target.getClientRects().length)
      target.focus({ preventScroll: true });
  },
);
onMounted(() => {
  panelMedia = window.matchMedia(EDITOR_PANEL_MEDIA_QUERY);
  document.addEventListener('focusin', rememberFocus, true);
  document.addEventListener('focusout', releaseFocus, true);
  document.addEventListener('pointerdown', outsidePointer, true);
  window.addEventListener('blur', invalidateFocus);
});
onBeforeUnmount(() => {
  document.removeEventListener('focusin', rememberFocus, true);
  document.removeEventListener('focusout', releaseFocus, true);
  document.removeEventListener('pointerdown', outsidePointer, true);
  window.removeEventListener('blur', invalidateFocus);
  invalidateFocus();
  movingFocus = false;
  panelMedia = undefined;
  dialog = undefined;
});
</script>

<template>
  <aside
    :id="mobile ? undefined : id"
    ref="desktop"
    class="editor-side-panel"
    :class="`is-${side ?? 'left'}`"
    :aria-label="label"
  >
    <Teleport :to="destination ?? 'body'" :disabled="!active || !destination">
      <slot />
    </Teleport>
  </aside>
  <USlideover
    :open="active"
    :title="label"
    :content="content"
    :portal="false"
    :transition="false"
    :close="false"
    :side="side ?? 'left'"
    :ui="{
      overlay: 'editor-panel-overlay',
      content: 'editor-panel-dialog',
      body: 'editor-panel-dialog-body',
    }"
    @update:open="emit('update:open', $event)"
  >
    <template #actions>
      <EditorButton
        icon="i-lucide-x"
        :aria-label="closeLabel"
        :title="closeLabel"
        @click="emit('update:open', false)"
      />
    </template>
    <template #body><div ref="destination" class="editor-panel-dialog-content" /></template>
  </USlideover>
</template>
