<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import UAccordion from '@nuxt/ui/components/Accordion.vue';

export interface EditorPropertyGroupItem {
  readonly id: string;
  readonly label: string;
  readonly openByDefault?: boolean;
}

const props = defineProps<{
  groups: readonly EditorPropertyGroupItem[];
  contextId: string;
}>();
const opened = ref<string[]>([]);
const items = computed(() =>
  props.groups.map((group) => ({ value: group.id, label: group.label })),
);
watch(
  () => props.contextId,
  () => {
    opened.value = props.groups.filter((group) => group.openByDefault).map((group) => group.id);
  },
  { immediate: true },
);
watch(
  () => props.groups.map((group) => group.id).join(','),
  () => {
    const available = new Set(props.groups.map((group) => group.id));
    opened.value = opened.value.filter((id) => available.has(id));
  },
);
const update = (value: unknown): void => {
  if (!Array.isArray(value)) return;
  const available = new Set(props.groups.map((group) => group.id));
  opened.value = value.filter((id): id is string => typeof id === 'string' && available.has(id));
};
</script>

<template>
  <UAccordion
    type="multiple"
    :items="items"
    :model-value="opened"
    :unmount-on-hide="false"
    trailing-icon="i-lucide-chevron-down"
    class="editor-property-groups"
    @update:model-value="update"
  >
    <template #body="{ item }"><slot :name="item.value" /></template>
  </UAccordion>
</template>
