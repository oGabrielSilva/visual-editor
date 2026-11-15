<script setup lang="ts">
import UTabs from '@nuxt/ui/components/Tabs.vue';

export interface EditorTabItem {
  readonly value: string;
  readonly label: string;
  readonly icon?: string;
  readonly disabled?: boolean;
}

defineProps<{
  modelValue: string;
  items: readonly EditorTabItem[];
  label: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<template>
  <UTabs
    :model-value="modelValue"
    :items="items.map((item) => ({ ...item, slot: item.value }))"
    :aria-label="label"
    :unmount-on-hide="false"
    variant="link"
    size="sm"
    color="primary"
    class="editor-tabs"
    :ui="{ list: 'editor-tabs-list', content: 'editor-tabs-content' }"
    @update:model-value="emit('update:modelValue', String($event))"
  >
    <template v-for="item in items" :key="item.value" #[item.value]>
      <slot :name="item.value" />
    </template>
  </UTabs>
</template>
