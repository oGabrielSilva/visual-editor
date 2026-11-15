<script setup lang="ts">
import { computed } from 'vue';
import UAlert from '@nuxt/ui/components/Alert.vue';

const props = withDefaults(
  defineProps<{
    title: string;
    tone?: 'warning' | 'error' | 'info';
    icon?: string;
    /** Label of the button which dismisses the notice; without it the notice stays. */
    dismissLabel?: string;
  }>(),
  { tone: 'warning', icon: 'i-lucide-triangle-alert', dismissLabel: '' },
);
const emit = defineEmits<{ dismiss: [] }>();
// The accessible name travels as an attribute of the button, beyond its typed options.
const closeButton = computed(() =>
  props.dismissLabel
    ? {
        color: 'neutral' as const,
        variant: 'ghost' as const,
        ...{ 'aria-label': props.dismissLabel, title: props.dismissLabel },
      }
    : false,
);
</script>

<template>
  <UAlert
    :title="title"
    :color="tone"
    :icon="icon"
    variant="subtle"
    class="editor-notice"
    :close="closeButton"
    @update:open="emit('dismiss')"
  >
    <template v-if="$slots.default" #description><slot /></template>
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </UAlert>
</template>
