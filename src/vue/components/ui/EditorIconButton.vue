<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue';
import UTooltip from '@nuxt/ui/components/Tooltip.vue';

defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    icon: string;
    label: string;
    /** Keys of the shortcut, shown in the tip: `['meta', 'Z']`. */
    kbds?: readonly string[];
    disabled?: boolean;
    active?: boolean | undefined;
    intent?: 'neutral' | 'primary' | 'destructive';
    size?: 'xs' | 'sm' | 'md';
  }>(),
  { kbds: () => [], disabled: false, active: undefined, intent: 'neutral', size: 'sm' },
);
</script>

<template>
  <UTooltip :text="label" :kbds="[...kbds]" :portal="false" :disabled="disabled">
    <UButton
      v-bind="$attrs"
      type="button"
      :icon="icon"
      :size="size"
      :color="
        intent === 'destructive' ? 'error' : intent === 'primary' || active ? 'primary' : 'neutral'
      "
      :variant="intent === 'primary' ? 'solid' : active ? 'soft' : 'ghost'"
      :disabled="disabled"
      :aria-label="label"
      :aria-pressed="active"
      :data-editor-active="active"
      class="editor-button editor-icon-button"
    />
  </UTooltip>
</template>
