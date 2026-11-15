// Addresses and navigation of the site, in one place.
export const SITE_URL = 'https://ogabrielsilva.github.io/visual-editor/';
export const REPOSITORY_URL = 'https://github.com/oGabrielSilva/visual-editor';
export const NPM_URL = 'https://www.npmjs.com/package/@lyads/visual-editor';
export const AUTHOR_URL = 'https://github.com/oGabrielSilva';
export const DOCS_URL = `${REPOSITORY_URL}/blob/main`;

/** The sections of the page, in order: the header follows the one on screen. */
export const SECTIONS = [
  { id: 'playground', label: 'Playground', icon: 'i-lucide-mouse-pointer-click' },
  { id: 'recursos', label: 'Recursos', icon: 'i-lucide-sparkles' },
  { id: 'como-funciona', label: 'Como funciona', icon: 'i-lucide-workflow' },
  { id: 'instalar', label: 'Instalar', icon: 'i-lucide-package' },
  { id: 'seguranca', label: 'Segurança', icon: 'i-lucide-shield-check' },
  { id: 'perguntas', label: 'Perguntas', icon: 'i-lucide-circle-help' },
] as const;

export const DOCUMENTS = [
  { label: 'README', to: `${DOCS_URL}/README.md`, icon: 'i-lucide-book-open' },
  { label: 'Arquitetura', to: `${DOCS_URL}/docs/architecture.md`, icon: 'i-lucide-blocks' },
  { label: 'Segurança', to: `${DOCS_URL}/docs/security.md`, icon: 'i-lucide-shield' },
  { label: 'Como contribuir', to: `${DOCS_URL}/CONTRIBUTING.md`, icon: 'i-lucide-git-pull-request' },
  { label: 'Changelog', to: `${DOCS_URL}/CHANGELOG.md`, icon: 'i-lucide-history' },
] as const;

/** The playground of the editor, a page of its own published with the site. */
export const PLAYGROUND_PATH = 'playground/';
export const PLAYGROUND_PIECES = [
  {
    title: 'E-mail em blocos',
    description: 'Uma newsletter pronta: edite os textos, troque o botão, veja no celular e use Conferir.',
    icon: 'i-lucide-mail',
    query: '?schema=2&kind=email&template=email-newsletter',
  },
  {
    title: 'Landing page em blocos',
    description: 'Uma página de material gratuito com colunas, estilos globais e blocos para arrastar.',
    icon: 'i-lucide-layout-template',
    query: '?schema=2&template=page-material',
  },
  {
    title: 'Documento HTML',
    description: 'O editor de HTML importado, com modo visual e modo código sobre o mesmo histórico.',
    icon: 'i-lucide-code-xml',
    query: '',
  },
] as const;
