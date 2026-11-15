// Markdown rendered by MDC into the code components of Nuxt UI (tabs, highlighting, copy).
const fence = (language: string, label: string, code: string): string =>
  `\`\`\`${language} [${label}]\n${code}\n\`\`\``;
const group = (...blocks: string[]): string => `::code-group\n${blocks.join('\n')}\n::`;

const PACKAGE = '@lyads/visual-editor';

export const INSTALL_MARKDOWN = group(
  fence('bash', 'npm', `npm install ${PACKAGE}`),
  fence('bash', 'yarn', `yarn add ${PACKAGE}`),
  fence('bash', 'pnpm', `pnpm add ${PACKAGE}`),
  fence('bash', 'bun', `bun add ${PACKAGE}`),
);

export const USAGE_MARKDOWN = group(
  fence(
    'vue',
    'Vue',
    `<script setup lang="ts">
import { onBeforeUnmount } from 'vue';
import { createBlockEditor } from '${PACKAGE}';
import { BlockVisualEditor } from '${PACKAGE}/vue';
import '${PACKAGE}/styles.css';

const editor = createBlockEditor({
  kind: 'email',
  language: 'pt-BR',
  store: {
    // Recebe a peça (JSON) e a saída gerada; responde com a nova revisão.
    save: async (document, output, expectedRevision) => ({ revision: document.revision }),
  },
});
onBeforeUnmount(() => editor.dispose());
</script>

<template>
  <BlockVisualEditor
    :controller="editor.controller"
    :selection-renderer="editor.selectionRenderer"
  />
</template>`,
  ),
  fence(
    'vue',
    'Nuxt',
    `<template>
  <!-- O editor monta no cliente: o quadro de edição depende do navegador. -->
  <ClientOnly>
    <MyBlockEditor />
  </ClientOnly>
</template>`,
  ),
  fence(
    'ts',
    'Servidor',
    `import { createServerBlockToolkit } from '${PACKAGE}/server';

const toolkit = createServerBlockToolkit();
const parsed = toolkit.parse(body); // valida a peça; lança erro se for inválida
if (parsed.schemaVersion === 2) {
  const output = await toolkit.render(parsed.document); // HTML final do e-mail ou da página
}`,
  ),
);
