<script setup lang="ts">
import UCheckbox from '@nuxt/ui/components/Checkbox.vue';

const props = defineProps<{ id: string; modelValue: boolean; label: string; disabled: boolean }>();
const emit = defineEmits<{ change: [value: boolean] }>();
const change = (value: unknown): void => {
  if (!props.disabled && typeof value === 'boolean') emit('change', value);
};
</script>

<template>
  <UCheckbox
    :id="id"
    :model-value="modelValue"
    :label="label"
    :disabled="disabled"
    @update:model-value="change"
  />
</template>
