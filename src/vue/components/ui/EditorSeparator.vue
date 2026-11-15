<script setup lang="ts">
import USeparator from '@nuxt/ui/components/Separator.vue';

withDefaults(defineProps<{ orientation?: 'horizontal' | 'vertical' }>(), {
  orientation: 'vertical',
});
</script>

<template>
  <USeparator :orientation="orientation" class="editor-separator" />
</template>
