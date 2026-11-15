# Como contribuir

## Ambiente

- Node 22.12 ou superior.
- Yarn 4.18.0, fixado no repositório (`.yarn/releases`). Rode `yarn install --immutable`.

## Comandos

| Comando | O que faz |
| --- | --- |
| `yarn dev` | Abre o playground em `http://127.0.0.1:6010`. |
| `yarn build` | Gera o runtime do quadro, a biblioteca, os tipos e o playground estático. |
| `yarn validate` | Formatação, tipos, lint, build e testes unitários. |
| `yarn test` | Testes unitários (Vitest). Alguns usam o worker gerado: rode `yarn build` antes. |
| `yarn test:e2e` | Testes de navegador (Playwright: Chromium, Firefox e WebKit) contra o playground estático. Outra porta: `VISUAL_EDITOR_E2E_ORIGIN=http://127.0.0.1:6031`. |
| `yarn runtime` | Regenera `src/renderers/canvas-runtime.generated.ts` depois de mudar `src/canvas-runtime`. |

## Site do projeto

O site fica em `website/`, um app Nuxt com Nuxt UI e dependências próprias, gerado como
HTML estático para o GitHub Pages:

```bash
yarn install --immutable        # na raiz: o playground do site é gerado do próprio pacote
cd website
yarn install --immutable
yarn playground                 # gera o playground em website/public/playground
yarn generate                   # saída em website/.output/public
```

O site segue o tema do Lyads (Nuxt UI com teal e neutro, raio zero, Google Sans Flex e Code) e
usa só componentes do Nuxt UI, sem CSS próprio além desses tokens.

As capturas de tela são do playground real: com `yarn build` feito e `yarn preview --port 6041`
rodando, gere-as com `node website/capture.mjs http://127.0.0.1:6041`.

## Publicação no npm

Uma release publicada no GitHub dispara `.github/workflows/publish.yml`, que valida, gera e
publica o pacote com proveniência. A autenticação é pelo Trusted Publishing do npm: nenhum
token fica guardado no repositório. Antes de criar a release, suba a versão no `package.json`.

## Convenções

- Classes pequenas, uma responsabilidade cada. O domínio (`core`, `application`, `blocks`) não
  importa Vue.
- A interface nunca muta o documento: pede um comando ao controlador, que o repassa à sessão.
- Todo valor que vem de fora (documento, mensagem do quadro, resposta de uma porta do host) é
  validado antes de ser usado.
- Textos da interface ficam em `src/vue/locales/pt-BR.json`; o host pode substituí-los.
- Comentários explicam o porquê, em inglês.
- Mudança de comportamento vem com teste; mudança visível na interface, com teste de navegador.

## Antes de abrir um pull request

```bash
yarn validate
yarn test:e2e
```

Questões de segurança: veja [SECURITY.md](SECURITY.md).
