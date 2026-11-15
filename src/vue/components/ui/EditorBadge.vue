<script setup lang="ts">
import UBadge from '@nuxt/ui/components/Badge.vue';

withDefaults(defineProps<{ tone?: 'neutral' | 'primary' | 'warning' | 'error' | 'success' }>(), {
  tone: 'neutral',
});
</script>

<template>
  <UBadge :color="tone" variant="subtle" size="sm" class="editor-badge"><slot /></UBadge>
</template>
