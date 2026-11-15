<script setup lang="ts">
import USwitch from '@nuxt/ui/components/Switch.vue';

defineProps<{ modelValue: boolean; label: string; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
</script>

<template>
  <USwitch
    :model-value="modelValue"
    :label="label"
    :disabled="disabled"
    size="sm"
    class="editor-switch"
    @update:model-value="emit('update:modelValue', !!$event)"
  />
</template>
