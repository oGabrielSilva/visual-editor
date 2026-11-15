<script setup lang="ts">
import UEmpty from '@nuxt/ui/components/Empty.vue';

defineProps<{ icon: string; title: string; description?: string }>();
</script>

<template>
  <UEmpty
    :icon="icon"
    :title="title"
    v-bind="description ? { description } : {}"
    variant="naked"
    size="sm"
    class="editor-empty"
  />
</template>
