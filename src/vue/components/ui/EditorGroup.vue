<script setup lang="ts">
import UFieldGroup from '@nuxt/ui/components/FieldGroup.vue';

defineProps<{ label: string }>();
</script>

<template>
  <UFieldGroup size="sm" role="group" :aria-label="label" class="editor-group"
    ><slot
  /></UFieldGroup>
</template>
