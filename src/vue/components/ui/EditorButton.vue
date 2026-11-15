<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue';

withDefaults(
  defineProps<{
    intent?: 'primary' | 'secondary' | 'neutral' | 'destructive';
    disabled?: boolean;
    active?: boolean | undefined;
    loading?: boolean;
    type?: 'button' | 'submit';
    size?: 'xs' | 'sm' | 'md';
  }>(),
  {
    intent: 'neutral',
    disabled: false,
    active: undefined,
    loading: false,
    type: 'button',
    size: 'sm',
  },
);
</script>

<template>
  <UButton
    :type="type"
    :size="size"
    :color="
      intent === 'destructive' ? 'error' : intent === 'primary' || active ? 'primary' : 'neutral'
    "
    :variant="
      intent === 'primary'
        ? 'solid'
        : active
          ? 'soft'
          : intent === 'secondary'
            ? 'outline'
            : intent === 'destructive'
              ? 'subtle'
              : 'ghost'
    "
    :disabled="disabled"
    :loading="loading"
    :data-editor-intent="intent"
    :data-editor-active="active"
    :aria-pressed="active"
    class="editor-button"
    ><slot
  /></UButton>
</template>
