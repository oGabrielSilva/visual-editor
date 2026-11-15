<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { CSSProperties } from 'vue';
import type { DocumentKind } from '../../../core/document';
import USkeleton from '@nuxt/ui/components/Skeleton.vue';

const props = defineProps<{ html: string; kind: DocumentKind; title: string }>();
const root = ref<HTMLElement>();
const width = ref(0);
let observer: ResizeObserver | undefined;
const viewportWidth = computed(() => (props.kind === 'email' ? 600 : 1000));
const frameStyle = computed<CSSProperties>(() => ({
  width: `${viewportWidth.value}px`,
  height: '700px',
  transform: `scale(${Math.min(1, Math.max(0, width.value) / viewportWidth.value)})`,
}));
onMounted(() => {
  observer = new ResizeObserver((entries) => {
    width.value = Math.min(3200, entries[0]?.contentRect.width ?? 0);
  });
  if (root.value) {
    width.value = root.value.clientWidth;
    observer.observe(root.value);
  }
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div ref="root" class="editor-template-thumbnail" aria-hidden="true">
    <iframe
      v-if="html"
      :srcdoc="html"
      :title="title"
      sandbox=""
      referrerpolicy="no-referrer"
      tabindex="-1"
      :style="frameStyle"
    />
    <USkeleton v-else class="editor-template-skeleton" />
  </div>
</template>
