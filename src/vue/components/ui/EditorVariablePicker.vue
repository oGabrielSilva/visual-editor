<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EditorLocale } from '../../locale';
import { VariableCatalog } from '../../variables';
import type { EditorVariable } from '../../variables';
import EditorButton from './EditorButton.vue';
import EditorContextPopover from './EditorContextPopover.vue';
import EditorMenu from './EditorMenu.vue';
import type { EditorMenuItem } from './EditorMenu.vue';

export type { EditorVariable } from '../../variables';

const props = withDefaults(
  defineProps<{
    variables: readonly EditorVariable[];
    purpose: 'text' | 'url';
    locale: EditorLocale;
    disabled: boolean;
    /** Why nothing can be inserted right now; shown instead of a control which only looks off. */
    hint?: string;
  }>(),
  { hint: '' },
);
const emit = defineEmits<{ insert: [key: string] }>();
const hintOpen = ref(false);
const label = computed(() => props.locale.text('actions.insertVariable'));
const catalog = computed(() => new VariableCatalog(props.variables));
const items = computed<EditorMenuItem[]>(() =>
  catalog.value.groups(props.purpose, props.locale.text('variables.general')).flatMap((group) => [
    { id: `heading:${group.label}`, label: group.label, heading: true, group: group.label },
    ...group.variables.map((variable) => ({
      id: variable.key,
      label: variable.label,
      description: `{{${variable.key}}}`,
      group: group.label,
    })),
  ]),
);
const insert = (key: string): void => {
  if (!props.disabled && catalog.value.token(key, props.purpose)) emit('insert', key);
};
</script>

<template>
  <template v-if="items.length">
    <EditorContextPopover
      v-if="disabled && hint"
      :open="hintOpen"
      :label="label"
      icon="i-lucide-braces"
      :disabled="false"
      @update:open="hintOpen = $event"
    >
      <p class="editor-variable-hint">{{ hint }}</p>
    </EditorContextPopover>
    <EditorMenu
      v-else
      :items="items"
      :label="label"
      :disabled="disabled"
      filter
      :filter-placeholder="locale.text('variables.search')"
      @select="insert"
    >
      <EditorButton
        icon="i-lucide-braces"
        :disabled="disabled"
        :title="label"
        class="editor-variable-picker"
        >{{ label }}</EditorButton
      >
      <template #empty>{{ locale.text('variables.empty') }}</template>
    </EditorMenu>
  </template>
</template>
