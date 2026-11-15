<script setup lang="ts">
import UIcon from '@nuxt/ui/runtime/vue/components/Icon.vue';

defineProps<{ name: string }>();
</script>

<template>
  <UIcon :name="name" class="editor-icon" aria-hidden="true" />
</template>
