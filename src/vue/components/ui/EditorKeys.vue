<script setup lang="ts">
import UKbd from '@nuxt/ui/components/Kbd.vue';

defineProps<{ keys: readonly string[] }>();
/** `Mod` is Ctrl or Cmd: the kbd primitive draws the right one for the platform. */
const value = (key: string): string =>
  key === 'Mod' ? 'meta' : key === 'Alt' ? 'alt' : key === 'Shift' ? 'shift' : key;
</script>

<template>
  <span class="editor-keys">
    <UKbd v-for="key in keys" :key="key" :value="value(key)" size="sm" />
  </span>
</template>
