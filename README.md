# @lyads/visual-editor

Editor visual de e-mails e landing pages para Vue 3. A pessoa edita o texto direto na peça,
arrasta e reorganiza blocos, troca imagens e alterna para o código HTML sem perder o trabalho.
O e-mail é gerado com MJML; a página, com HTML e CSS próprios.

O pacote é só o editor. Quem o integra (o *host*) decide onde a peça fica guardada, quem pode
editá-la, de onde vêm as imagens e as variáveis, e como a peça é enviada ou publicada.

## Recursos

- **Dois formatos de documento.**
  - *Documento HTML* (schema 1): uma árvore HTML validada, editável no modo visual e no modo
    código sobre o mesmo histórico. HTML importado é preservado; o que o editor não reconhece
    continua editável no código.
  - *Peça em blocos* (schema 2): seções, colunas, texto, título, imagem, botão, divisor,
    espaçador, rodapé, formulário e HTML livre, cada um com suas propriedades num lugar só, e
    estilos globais herdados. O e-mail é gerado com MJML a cada salvamento.
- **Edição no lugar**, com barra de formatação (negrito, itálico, links, cor, fonte, tamanho,
  listas), colagem limpa e variáveis do host mostradas como etiqueta.
- **Teclado e mouse**: selecionar, mover, duplicar, remover, desfazer e refazer por atalho;
  arrastar com linha de inserção e rolagem automática.
- **Celular e computador**: valores só de telas pequenas, ocultar um bloco por tela e ordem
  invertida de colunas no celular.
- **Conferência antes de enviar**: links vazios, imagens sem texto alternativo, botões sem
  link e e-mails acima do corte de 102 KB do Gmail.
- **Prévia escura** aproximada, modelos em português, inglês e espanhol, e blocos salvos pelo
  host para reaproveitar.

## Instalação

Requer Node 22.12 ou superior.

```bash
npm install @lyads/visual-editor
```

Vue 3.5 e Vue Router são dependências compartilhadas com o seu aplicativo. Site do projeto:
<https://ogabrielsilva.github.io/visual-editor/>.

## Uso

### Peça em blocos

```ts
import { createBlockEditor } from '@lyads/visual-editor';
import { BlockVisualEditor } from '@lyads/visual-editor/vue';
import '@lyads/visual-editor/styles.css';

const editor = createBlockEditor({
  kind: 'email', // ou 'page'
  language: 'pt-BR', // textos iniciais: pt-BR, en ou es
  store: {
    // Recebe a peça (JSON) e a saída gerada; responde com a nova revisão.
    async save(document, output, expectedRevision) {
      return { revision: document.revision };
    },
  },
});
```

```vue
<BlockVisualEditor
  :controller="editor.controller"
  :selection-renderer="editor.selectionRenderer"
  :image-picker="imagePicker"
  :saved-blocks="savedBlocks"
  :variables="variables"
/>
```

Ao desmontar, chame `editor.dispose()`.

### Documento HTML

```ts
import { createEditor } from '@lyads/visual-editor';
import { VisualEditor } from '@lyads/visual-editor/vue';

const editor = createEditor({
  kind: 'page',
  source: { html: '<h1>Seu próximo passo</h1>', css: '' },
  host: { store: documentStore },
});
```

### No servidor

`@lyads/visual-editor/server` não importa nada de Vue. Use-o para validar o que o cliente
envia e gerar a saída final no servidor, que é a fonte da verdade:

```ts
import { createServerBlockToolkit } from '@lyads/visual-editor/server';

const toolkit = createServerBlockToolkit();
const parsed = toolkit.parse(input); // valida a peça; lança erro se for inválida
if (parsed.schemaVersion === 2) {
  const output = await toolkit.render(parsed.document); // HTML do e-mail, ou HTML e CSS da página
}
```

A compilação MJML roda num worker Node com tempo e memória limitados.

### Portas do host

| Porta | Para quê |
| --- | --- |
| `store` | Guardar a peça com controle de revisão (o host faz a concorrência). |
| `imagePicker` | Escolher ou enviar imagens da biblioteca do host. |
| `savedBlocks` | Listar, salvar e remover blocos reaproveitáveis. |
| `variables` | Catálogo de variáveis (`{{contact.firstName}}`) com nomes amigáveis. |
| `messages` | Textos da interface; o padrão é pt-BR. |

## Segurança

O conteúdo da peça roda num iframe isolado, sem acesso à página do editor. E-mails têm scripts,
handlers e endereços de código removidos. **Páginas não são sanitizadas**: o HTML do autor sai
como foi escrito, scripts incluídos. Se você publicar a saída de uma página, sirva-a numa origem
separada da do seu aplicativo. Leia [docs/security.md](docs/security.md) antes de integrar e
[SECURITY.md](SECURITY.md) para relatar vulnerabilidades.

## Limites

- MJML melhora muito a compatibilidade, mas a renderização em clientes reais de e-mail
  (Outlook, Gmail, Apple Mail) não é certificada pelo pacote.
- A prévia escura é uma aproximação: cada cliente escurece de um jeito.
- Leitores de tela e aparelhos físicos não fazem parte dos testes automatizados.

## Desenvolvimento

Veja [CONTRIBUTING.md](CONTRIBUTING.md) e a [arquitetura](docs/architecture.md).

## Licença

Apache License 2.0: veja [LICENSE](LICENSE) e [NOTICE](NOTICE). A licença não dá direito de uso da marca Lyads. As dependências de terceiros mantêm suas licenças, listadas em
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
