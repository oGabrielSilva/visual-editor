<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import type { EditorController } from '../controller';
import type { EditorLocale } from '../locale';
import type { TemplateChoice } from '../services/template-application';
import EditorButton from './ui/EditorButton.vue';
import EditorTemplatePreview from './ui/EditorTemplatePreview.vue';

const props = defineProps<{
  controller: EditorController;
  locale: EditorLocale;
  disabled: boolean;
}>();
const emit = defineEmits<{ select: [value: TemplateChoice] }>();
const instanceId = useId();
const templates = computed(() => props.controller.templateList());
const previews = ref<Record<string, { status: 'loading' | 'ready' | 'error'; html: string }>>({});
let generation = 0;
let disposed = false;
let queue: Promise<void> = Promise.resolve();
const enqueue = (id: string): void => {
  const current = generation;
  const owner = props.controller;
  previews.value = { ...previews.value, [id]: { status: 'loading', html: '' } };
  queue = queue.then(async () => {
    if (disposed || generation !== current || props.controller !== owner) return;
    try {
      const html = await owner.templatePreview(id);
      if (!disposed && generation === current && props.controller === owner)
        previews.value = { ...previews.value, [id]: { status: 'ready', html } };
    } catch {
      if (!disposed && generation === current && props.controller === owner)
        previews.value = { ...previews.value, [id]: { status: 'error', html: '' } };
    }
  });
};
watch(
  () => props.controller,
  () => {
    generation++;
    previews.value = {};
    for (const template of templates.value) enqueue(template.id);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
const select = (id: string, event: MouseEvent): void => {
  const preview = previews.value[id];
  if (!props.disabled && preview?.status === 'ready' && event.currentTarget instanceof HTMLElement)
    emit('select', { id, html: preview.html, trigger: event.currentTarget });
};
</script>

<template>
  <ul class="editor-template-list">
    <li v-for="template in templates" :key="template.id">
      <button
        type="button"
        class="editor-template"
        :disabled="disabled || previews[template.id]?.status !== 'ready'"
        :aria-labelledby="`${instanceId}-${template.id}-title ${instanceId}-${template.id}-description`"
        :aria-busy="previews[template.id]?.status === 'loading'"
        @click="select(template.id, $event)"
      >
        <EditorTemplatePreview
          :html="previews[template.id]?.html ?? ''"
          :kind="template.kind"
          :title="locale.text(template.titleKey)"
        />
        <strong :id="`${instanceId}-${template.id}-title`">{{
          locale.text(template.titleKey)
        }}</strong
        >{{ ' ' }}
        <span :id="`${instanceId}-${template.id}-description`">{{
          locale.text(template.descriptionKey)
        }}</span>
      </button>
      <p v-if="previews[template.id]?.status === 'loading'" class="editor-help" role="status">
        {{ locale.text('feedback.busy') }}
      </p>
      <div v-else-if="previews[template.id]?.status === 'error'" class="editor-template-error">
        <p class="editor-help" role="status">{{ locale.text('templates.previewFailed') }}</p>
        <EditorButton :disabled="disabled" @click="enqueue(template.id)">{{
          locale.text('actions.retry')
        }}</EditorButton>
      </div>
    </li>
  </ul>
</template>
