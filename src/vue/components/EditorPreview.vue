<script setup lang="ts">
defineProps<{ html: string; label: string; width: 'mobile' | 'tablet' | 'desktop' }>();
</script>

<template>
  <div class="editor-preview-frame editor-preview-shell" :class="`is-${width}`">
    <iframe
      :title="label"
      :srcdoc="html"
      sandbox=""
      referrerpolicy="no-referrer"
      tabindex="-1"
      inert
      class="editor-preview"
    />
  </div>
</template>
