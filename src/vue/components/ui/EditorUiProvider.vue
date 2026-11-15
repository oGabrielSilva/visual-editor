<script setup lang="ts">
import UApp from '@nuxt/ui/components/App.vue';
</script>

<template>
  <UApp :toaster="null" :scroll-body="false">
    <slot />
  </UApp>
</template>
