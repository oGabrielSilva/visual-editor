<script setup lang="ts">
import type { FooterColumn } from '@nuxt/ui';

const base = useRuntimeConfig().app.baseURL;
const columns: FooterColumn[] = [
  {
    label: 'Autor',
    children: [
      { label: 'Gabriel Silva', to: AUTHOR_URL, target: '_blank', icon: 'i-simple-icons-github' },
    ],
  },
  {
    label: 'Projeto',
    children: [
      { label: 'Código no GitHub', to: REPOSITORY_URL, target: '_blank', icon: 'i-simple-icons-github' },
      { label: 'Pacote no npm', to: NPM_URL, target: '_blank', icon: 'i-simple-icons-npm' },
      { label: 'Relatar um problema', to: `${REPOSITORY_URL}/issues`, target: '_blank', icon: 'i-lucide-bug' },
    ],
  },
  {
    label: 'Documentação',
    children: DOCUMENTS.map((document) => ({ ...document, target: '_blank' })),
  },
  {
    label: 'Para assistentes de código',
    children: [
      { label: 'llms.txt', to: `${base}llms.txt`, target: '_blank', icon: 'i-lucide-bot' },
      { label: 'llms-full.txt', to: `${base}llms-full.txt`, target: '_blank', icon: 'i-lucide-file-text' },
    ],
  },
];
</script>

<template>
  <USeparator />
  <UFooter>
    <template #top>
      <UContainer>
        <UFooterColumns :columns="columns">
          <template #left>
            <div class="flex flex-col gap-3">
              <AppLogo />
              <p class="max-w-xs text-sm text-muted">
                Editor visual de e-mails e landing pages para Vue 3, de código aberto.
              </p>
            </div>
          </template>
        </UFooterColumns>
      </UContainer>
    </template>

    <template #left>
      <p class="text-sm text-muted">
        © 2026
        <ULink :to="AUTHOR_URL" target="_blank" class="font-medium text-highlighted hover:text-primary"
          >Gabriel Silva</ULink
        >. Editor sob a licença Apache-2.0; a marca Lyads não faz parte da licença.
      </p>
    </template>

    <template #right>
      <UButton
        :to="AUTHOR_URL"
        target="_blank"
        color="neutral"
        variant="ghost"
        icon="i-simple-icons-github"
        aria-label="Gabriel Silva no GitHub"
      />
      <UButton
        :to="NPM_URL"
        target="_blank"
        color="neutral"
        variant="ghost"
        icon="i-simple-icons-npm"
        aria-label="Pacote no npm"
      />
    </template>
  </UFooter>
</template>
