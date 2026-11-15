<script setup lang="ts">
// The mark of Lyads: an "L" on the primary color, with the name of the project beside it.
withDefaults(defineProps<{ name?: boolean }>(), { name: true });
</script>

<template>
  <span class="inline-flex items-center gap-2 font-semibold tracking-tight text-highlighted">
    <span
      class="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-inverted"
      aria-hidden="true"
      >L</span
    >
    <span v-if="name" class="text-lg">Visual Editor</span>
  </span>
</template>
