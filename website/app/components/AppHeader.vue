<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui';

const base = useRuntimeConfig().app.baseURL;
const active = useActiveSection(SECTIONS.map((section) => section.id));
const items = computed<NavigationMenuItem[]>(() =>
  SECTIONS.map((section) => ({
    label: section.label,
    to: { hash: `#${section.id}` },
    active: active.value === section.id,
  })),
);
const mobileItems = computed<NavigationMenuItem[]>(() =>
  SECTIONS.map((section) => ({
    label: section.label,
    icon: section.icon,
    to: { hash: `#${section.id}` },
    active: active.value === section.id,
  })),
);
</script>

<template>
  <UHeader to="/" title="Lyads Visual Editor">
    <template #title>
      <AppLogo />
    </template>

    <UNavigationMenu :items="items" variant="link" aria-label="Seções da página" />

    <template #right>
      <UColorModeButton />
      <UTooltip text="Código no GitHub">
        <UButton
          :to="REPOSITORY_URL"
          target="_blank"
          color="neutral"
          variant="ghost"
          icon="i-simple-icons-github"
          aria-label="Código no GitHub"
        />
      </UTooltip>
      <UButton
        :to="`${base}${PLAYGROUND_PATH}${PLAYGROUND_PIECES[0].query}`"
        target="_blank"
        label="Testar"
        icon="i-lucide-play"
        class="hidden sm:inline-flex"
      />
    </template>

    <template #body>
      <UNavigationMenu :items="mobileItems" orientation="vertical" class="-mx-2.5" />
    </template>
  </UHeader>
</template>
