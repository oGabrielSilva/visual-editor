<script setup lang="ts">
import type { AccordionItem, ButtonProps } from '@nuxt/ui';

const base = useRuntimeConfig().app.baseURL;
const asset = (name: string): string => `${base}assets/${name}`;

const title = 'Lyads Visual Editor: editor visual de e-mails e landing pages para Vue';
const description =
  'Editor visual de código aberto (Apache-2.0) para e-mails e landing pages em Vue 3: edição direto na peça, blocos com saída MJML, HTML editável e validação no servidor.';

const playground = (query = ''): string => `${base}${PLAYGROUND_PATH}${query}`;
const heroLinks: ButtonProps[] = [
  {
    label: 'Testar no playground',
    to: playground(PLAYGROUND_PIECES[0].query),
    target: '_blank',
    icon: 'i-lucide-play',
    size: 'xl',
  },
  { label: 'Instalar', to: { hash: '#instalar' }, icon: 'i-lucide-package', size: 'xl', color: 'neutral', variant: 'subtle' },
];

const capabilities = [
  { label: 'Edição direto na peça', icon: 'i-lucide-text-cursor-input' },
  { label: 'Blocos com saída MJML', icon: 'i-lucide-mail' },
  { label: 'Landing pages', icon: 'i-lucide-layout-template' },
  { label: 'Modo código HTML', icon: 'i-lucide-code-xml' },
  { label: 'Celular e computador', icon: 'i-lucide-smartphone' },
  { label: 'Conferência antes de enviar', icon: 'i-lucide-list-checks' },
  { label: 'Prévia escura', icon: 'i-lucide-moon' },
  { label: 'Variáveis como etiqueta', icon: 'i-lucide-braces' },
  { label: 'Blocos salvos', icon: 'i-lucide-bookmark-plus' },
  { label: 'Desfazer e refazer', icon: 'i-lucide-undo-2' },
  { label: 'Teclado completo', icon: 'i-lucide-keyboard' },
  { label: 'Modelos em 3 idiomas', icon: 'i-lucide-languages' },
];

const features = [
  {
    title: 'Edição direto na peça',
    description: 'A pessoa clica no texto e escreve, com negrito, links, cores, listas e colagem limpa.',
    icon: 'i-lucide-text-cursor-input',
  },
  {
    title: 'Blocos de verdade',
    description: 'Seções, colunas, texto, imagem, botão, rodapé e HTML livre, com estilos globais herdados.',
    icon: 'i-lucide-blocks',
  },
  {
    title: 'E-mail com MJML',
    description: 'Cada peça vira MJML e é compilada para HTML de e-mail com colunas responsivas.',
    icon: 'i-lucide-mail-check',
  },
  {
    title: 'HTML editável',
    description: 'Modo visual e modo código sobre o mesmo documento e o mesmo histórico.',
    icon: 'i-lucide-code-xml',
  },
  {
    title: 'Celular separado',
    description: 'Tamanho, alinhamento e espaçamento só do celular; ocultar por tela; colunas invertidas.',
    icon: 'i-lucide-smartphone',
  },
  {
    title: 'Conferência antes de enviar',
    description: 'Links vazios, imagens sem texto alternativo e e-mails acima do corte do Gmail.',
    icon: 'i-lucide-list-checks',
  },
  {
    title: 'Arrastar e teclado',
    description: 'Arraste com linha de inserção e rolagem automática, e atalhos para tudo.',
    icon: 'i-lucide-move',
  },
  {
    title: 'Blocos salvos',
    description: 'Guarde uma seção ou um bloco e reaproveite em outras peças.',
    icon: 'i-lucide-bookmark-plus',
  },
  {
    title: 'Validação no servidor',
    description: 'Um kit sem Vue valida a peça e compila o MJML num worker com tempo e memória limitados.',
    icon: 'i-lucide-server-cog',
  },
];

const gallery = [
  { image: 'blocks-email.png', caption: 'Um e-mail em blocos, com um título selecionado e o painel de propriedades.' },
  { image: 'blocks-page.png', caption: 'Uma landing page em blocos, com os estilos globais da peça.' },
  { image: 'mobile.png', caption: 'A largura de celular: os campos marcados valem só em telas pequenas.' },
  { image: 'review.png', caption: 'A conferência aponta um botão sem link, com atalho para o bloco.' },
  { image: 'dark.png', caption: 'A prévia aproximada do modo escuro dos leitores de e-mail.' },
  { image: 'html-document.png', caption: 'O documento HTML, editável no modo visual e no código.' },
];

const steps = [
  {
    title: 'Você monta o editor',
    description: 'Um componente Vue e uma fábrica. O host diz onde a peça fica guardada e de onde vêm imagens e variáveis.',
    icon: 'i-lucide-plug',
  },
  {
    title: 'A pessoa edita',
    description: 'Cada mudança é uma revisão validada, com desfazer e refazer. O conteúdo roda num iframe isolado.',
    icon: 'i-lucide-pencil-line',
  },
  {
    title: 'Você recebe JSON e HTML',
    description: 'O salvamento entrega o documento e a saída gerada. No servidor, o mesmo pacote revalida antes de gravar.',
    icon: 'i-lucide-database',
  },
];

const security = [
  {
    title: 'Quadro isolado',
    description: 'Iframe em origem opaca; só o script do editor executa, autorizado pelo próprio resumo SHA-256.',
    icon: 'i-lucide-box',
  },
  {
    title: 'E-mail sem conteúdo ativo',
    description: 'Scripts, handlers e endereços de código são removidos, e o autor é avisado.',
    icon: 'i-lucide-mail-x',
  },
  {
    title: 'Compilação contida',
    description: 'MJML num worker com memória limitada e tempo-limite; includes e componentes externos recusados.',
    icon: 'i-lucide-cpu',
  },
];

const questions: AccordionItem[] = [
  {
    label: 'O que é o Lyads Visual Editor?',
    content:
      'É um editor visual de e-mails e landing pages para Vue 3, de código aberto sob a licença Apache-2.0. A pessoa edita o texto direto na peça, reorganiza blocos e troca imagens; o aplicativo recebe um documento JSON validado e o HTML gerado.',
  },
  {
    label: 'Como o e-mail é gerado?',
    content:
      'Com MJML. Cada peça em blocos vira MJML e é compilada para HTML de e-mail com tabelas e colunas responsivas. A compilação roda num worker, no navegador ou no Node.',
  },
  {
    label: 'Funciona com Nuxt?',
    content:
      'Sim. Os componentes são Vue 3 e usam Nuxt UI; o editor monta no cliente. No servidor, use a entrada @lyads/visual-editor/server, que não importa Vue.',
  },
  {
    label: 'Onde as peças ficam guardadas?',
    content:
      'No seu aplicativo. O editor recebe uma porta store e chama save com a peça, a saída gerada e a revisão esperada. Autorização, persistência, envio e publicação ficam com você.',
  },
  {
    label: 'É seguro mostrar o HTML de quem escreve a peça?',
    content:
      'Dentro do editor, sim: a peça roda num iframe isolado e só o script do próprio editor executa. E-mails saem sem scripts. Páginas guardam o HTML do autor como foi escrito, então publique-as numa origem separada da do seu aplicativo.',
  },
  {
    label: 'Quanto custa?',
    content: 'Nada. O editor é gratuito, de código aberto, e não depende de serviço pago.',
  },
];

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  ogType: 'website',
  ogUrl: SITE_URL,
  ogImage: `${SITE_URL}assets/blocks-email.png`,
  ogImageAlt: 'O editor com um e-mail em blocos e um título selecionado.',
  ogLocale: 'pt_BR',
  twitterCard: 'summary_large_image',
});

useHead({
  link: [
    { rel: 'canonical', href: SITE_URL },
    { rel: 'alternate', type: 'text/plain', href: `${SITE_URL}llms.txt`, title: 'llms.txt' },
  ],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'SoftwareSourceCode',
            name: 'Lyads Visual Editor',
            alternateName: '@lyads/visual-editor',
            description,
            url: SITE_URL,
            codeRepository: REPOSITORY_URL,
            programmingLanguage: ['TypeScript', 'Vue'],
            runtimePlatform: 'Node.js 22',
            license: 'https://www.apache.org/licenses/LICENSE-2.0',
            author: { '@type': 'Person', name: 'Gabriel Silva', url: AUTHOR_URL },
            inLanguage: 'pt-BR',
          },
          {
            '@type': 'SoftwareApplication',
            name: 'Lyads Visual Editor',
            applicationCategory: 'DeveloperApplication',
            operatingSystem: 'Any',
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'BRL' },
            url: SITE_URL,
          },
          {
            '@type': 'FAQPage',
            mainEntity: questions.map((item) => ({
              '@type': 'Question',
              name: item.label,
              acceptedAnswer: { '@type': 'Answer', text: item.content },
            })),
          },
        ],
      }),
    },
  ],
});
</script>

<template>
  <div>
    <UPageHero
      title="Edite e-mails e páginas direto na peça"
      description="Um editor visual de código aberto para Vue 3. A pessoa clica no texto e escreve, reorganiza blocos, troca imagens e ajusta o celular. Você recebe um documento JSON validado e o HTML pronto para enviar ou publicar."
      :links="heroLinks"
    >
      <template #headline>
        <UBadge
          label="Código aberto, licença Apache-2.0"
          icon="i-lucide-scale"
          variant="subtle"
          size="lg"
        />
      </template>
      <UMarquee pause-on-hover :overlay="false">
        <UBadge
          v-for="capability in capabilities"
          :key="capability.label"
          :label="capability.label"
          :icon="capability.icon"
          color="neutral"
          variant="outline"
          size="lg"
        />
      </UMarquee>
    </UPageHero>

    <UPageSection
      id="playground"
      headline="Playground"
      title="Teste o editor agora"
      description="O editor de verdade, numa tela só dele, sem instalar nada. Tudo roda no seu navegador e nada é enviado."
      icon="i-lucide-mouse-pointer-click"
    >
      <UPageGrid>
        <UPageCard
          v-for="piece in PLAYGROUND_PIECES"
          :key="piece.title"
          :title="piece.title"
          :description="piece.description"
          :icon="piece.icon"
          :to="playground(piece.query)"
          target="_blank"
          spotlight
        >
          <template #footer>
            <UBadge
              label="Abrir no playground"
              trailing-icon="i-lucide-arrow-up-right"
              variant="subtle"
            />
          </template>
        </UPageCard>
      </UPageGrid>
    </UPageSection>

    <USeparator />

    <UPageSection
      id="recursos"
      headline="Recursos"
      title="O que o editor faz"
      description="Tudo que a pessoa precisa para montar a peça, e tudo que o seu aplicativo precisa para confiar nela."
      icon="i-lucide-sparkles"
    >
      <UPageGrid>
        <UPageCard
          v-for="feature in features"
          :key="feature.title"
          :title="feature.title"
          :description="feature.description"
          :icon="feature.icon"
          spotlight
        />
      </UPageGrid>
    </UPageSection>

    <UPageSection
      headline="Galeria"
      title="Por dentro do editor"
      description="Capturas do próprio editor, com o conteúdo de exemplo."
      icon="i-lucide-images"
    >
      <UCarousel
        v-slot="{ item }"
        :items="gallery"
        :autoplay="{ delay: 4000 }"
        loop
        arrows
        dots
        :prev="{ color: 'neutral', variant: 'subtle' }"
        :next="{ color: 'neutral', variant: 'subtle' }"
        :ui="{ prev: 'sm:start-4', next: 'sm:end-4' }"
      >
        <figure class="flex flex-col gap-3">
          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <img
              :src="asset(item.image)"
              width="1424"
              height="884"
              loading="lazy"
              :alt="item.caption"
              class="block w-full"
            />
          </UCard>
          <figcaption class="text-center text-sm text-muted">{{ item.caption }}</figcaption>
        </figure>
      </UCarousel>
    </UPageSection>

    <USeparator />

    <UPageSection
      id="como-funciona"
      headline="Como funciona"
      title="O editor edita; o seu aplicativo decide"
      description="Autorização, armazenamento, envio e publicação ficam com você. O editor recebe isso por portas e entrega a peça validada."
      icon="i-lucide-workflow"
      :features="steps"
      orientation="horizontal"
    >
      <MDC :value="USAGE_MARKDOWN" tag="div" />
    </UPageSection>

    <UPageSection
      id="instalar"
      headline="Instalar"
      title="Instale com o seu gerenciador de pacotes"
      description="Requer Node 22.12 ou superior. Vue 3.5 e Vue Router são dependências compartilhadas com o seu aplicativo."
      icon="i-lucide-package"
      :links="[
        { label: 'Ler o README', to: `${DOCS_URL}/README.md`, target: '_blank', icon: 'i-lucide-book-open', color: 'neutral', variant: 'subtle' },
        { label: 'Pacote no npm', to: NPM_URL, target: '_blank', icon: 'i-simple-icons-npm', color: 'neutral', variant: 'ghost' },
      ]"
    >
      <MDC :value="INSTALL_MARKDOWN" tag="div" />
    </UPageSection>

    <USeparator />

    <UPageSection
      id="seguranca"
      headline="Segurança"
      title="Conteúdo do autor sem risco para o editor"
      description="O pacote isola o que a pessoa escreve e valida tudo de novo no servidor."
      icon="i-lucide-shield-check"
      :features="security"
      orientation="horizontal"
    >
      <UAlert
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Páginas guardam o HTML do autor"
        description="Scripts incluídos, por decisão de projeto. Se você publicar uma página, sirva-a numa origem separada da do seu aplicativo."
        :actions="[
          { label: 'Ler o guia de segurança', to: `${DOCS_URL}/docs/security.md`, target: '_blank', icon: 'i-lucide-external-link' },
        ]"
      />
    </UPageSection>

    <UPageSection
      id="perguntas"
      headline="Perguntas"
      title="Perguntas frequentes"
      icon="i-lucide-circle-help"
    >
      <UAccordion :items="questions" type="multiple" :unmount-on-hide="false" />
    </UPageSection>

    <UPageSection>
      <UPageCTA
        title="Pronto para colocar no seu aplicativo?"
        description="Teste no playground, leia o README e instale. O código é aberto e as contribuições são bem-vindas."
        variant="subtle"
        :links="[
          { label: 'Testar no playground', to: playground(PLAYGROUND_PIECES[0].query), target: '_blank', icon: 'i-lucide-play' },
          { label: 'Ver no GitHub', to: REPOSITORY_URL, target: '_blank', icon: 'i-simple-icons-github', color: 'neutral', variant: 'outline' },
        ]"
      />
    </UPageSection>
  </div>
</template>
