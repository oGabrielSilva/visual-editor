<script setup lang="ts">
import { useWindowScroll } from '@vueuse/core';

// Back to the top, once the page has scrolled past the first screen.
const { y } = useWindowScroll();
const visible = computed(() => y.value > 600);
const top = (): void => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
};
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="translate-y-2 opacity-0"
    leave-active-class="transition duration-150 ease-in"
    leave-to-class="translate-y-2 opacity-0"
  >
    <UButton
      v-if="visible"
      icon="i-lucide-arrow-up"
      square
      size="lg"
      class="fixed right-6 bottom-6 z-30 shadow-md sm:right-8 sm:bottom-8"
      aria-label="Voltar ao topo"
      title="Voltar ao topo"
      @click="top"
    />
  </Transition>
</template>
