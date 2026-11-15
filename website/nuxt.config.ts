// The project site: a static Nuxt app (`nuxt generate`) published to GitHub Pages. Every page is
// prerendered to HTML, so search engines and AI crawlers read the content without running
// JavaScript. Theme, typography and radius follow the Lyads application.
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  modules: ['@nuxt/ui', '@nuxtjs/mdc'],
  css: ['~/assets/css/main.css'],
  ssr: true,
  app: {
    // A project page of GitHub Pages lives under the name of the repository.
    baseURL: '/visual-editor/',
    head: {
      htmlAttrs: { lang: 'pt-BR' },
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/visual-editor/favicon.svg' }],
    },
  },
  ui: { mdc: true },
  // The fonts are files of the site, declared in main.css: no remote provider.
  fonts: {
    families: [
      { name: 'Google Sans Flex', provider: 'none' },
      { name: 'Google Sans Code', provider: 'none' },
    ],
  },
  mdc: {
    highlight: {
      theme: { default: 'github-light', dark: 'github-dark' },
      langs: ['bash', 'ts', 'vue', 'html'],
    },
  },
  icon: { mode: 'svg', serverBundle: { collections: ['lucide', 'simple-icons'] } },
  nitro: { prerender: { routes: ['/'], crawlLinks: false } },
  devtools: { enabled: false },
});
