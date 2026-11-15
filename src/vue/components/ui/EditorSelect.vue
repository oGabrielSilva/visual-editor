<script setup lang="ts">
import USelect from '@nuxt/ui/components/Select.vue';

export interface EditorSelectItem {
  readonly label: string;
  readonly value: string;
  readonly disabled?: boolean;
}
withDefaults(
  defineProps<{
    modelValue: string;
    items: readonly EditorSelectItem[];
    id?: string;
    disabled?: boolean;
    label?: string;
    invalid?: boolean;
  }>(),
  { id: '', disabled: false, label: '', invalid: false },
);
const emit = defineEmits<{ change: [value: string] }>();
const change = (value: unknown): void => {
  if (typeof value === 'string' && value.length) emit('change', value);
};
</script>

<template>
  <USelect
    v-bind="id ? { id } : {}"
    :model-value="modelValue"
    :items="[...items]"
    :disabled="disabled"
    :aria-label="label || undefined"
    :aria-invalid="invalid || undefined"
    :color="invalid ? 'error' : 'primary'"
    :portal="false"
    size="sm"
    class="editor-select"
    @update:model-value="change"
  />
</template>
