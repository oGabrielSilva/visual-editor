# Arquitetura

O pacote é organizado por responsabilidade, em classes pequenas. O domínio não conhece Vue; a
interface não muta o documento diretamente: ela pede comandos à sessão, que produz uma nova
revisão imutável.

## Camadas

| Pasta | Responsabilidade |
| --- | --- |
| `src/core` | Agregados imutáveis e seus esquemas: `EditorDocument` (schema 1), `BlockDocument` (schema 2), histórico, orçamentos de tamanho, contrato do quadro. |
| `src/application` | Sessões de edição (`EditorSession`, `BlockEditorSession`): comandos, histórico, seleção, texto em edição, salvamento com revisão. Portas para o host (`StorePort`, `BlockStorePort`). |
| `src/codecs` | Importação e exportação de HTML e CSS para a árvore do documento, com preservação do que o editor não reconhece. |
| `src/security` | Política de conteúdo por tipo de peça, sanitização de e-mail, política de URLs, inventário de conteúdo ativo, validação das mensagens do quadro. |
| `src/blocks` | Definições dos tipos de bloco (campos, regras, geradores), estilos globais, geração de MJML e de HTML de página, regras por dispositivo, conferência antes de enviar, conversão para documento HTML. |
| `src/compilation` | Compilação MJML em worker (navegador e Node), guarda de entrada e saída, filas de compilação. |
| `src/renderers` | Montagem do documento do quadro de edição: política de conteúdo, marcação das regiões selecionáveis e o script do runtime. |
| `src/canvas-runtime` | Código que roda dentro do quadro: seleção, edição de texto no lugar, arraste, teclado, ferramentas de imagem, etiquetas de variáveis. É empacotado em `src/renderers/canvas-runtime.generated.ts` por `yarn runtime`. |
| `src/rich-text` | Comandos e projeção do texto rico (Tiptap/ProseMirror). |
| `src/templates` | Modelos iniciais dos dois formatos, com textos em pt-BR, inglês e espanhol. |
| `src/composition` | Fábricas que montam o grafo de objetos: `createEditor`, `createBlockEditor` (navegador) e `createServerEditor`, `createServerBlockToolkit` (servidor). |
| `src/vue` | Casca Vue: componentes, controladores (fachadas da sessão), bancadas de estado, painéis gerados das definições, mensagens. |

Os testes de arquitetura (`tests/architecture`) impedem dependências cruzadas indevidas e ciclos
de import.

## Formatos

### Documento HTML (schema 1)

Uma árvore HTML acíclica validada, nunca a árvore interna do parser. O modo visual e o modo código
editam o mesmo documento e o mesmo histórico. Código temporariamente inválido fica num buffer e
preserva o último documento válido.

### Peça em blocos (schema 2)

```text
BlockDocument
├── meta.lang
├── styles            estilos globais (corpo, títulos, botões, divisores…)
└── blocks[]          seções → colunas → blocos de conteúdo
    └── Block { id, type, props, mobile?, children? }
```

- `props` guarda só o que o autor definiu; o resto é herdado dos estilos globais e, depois, dos
  padrões do catálogo.
- `mobile` guarda valores só de telas pequenas para os campos responsivos (tamanho do texto,
  entrelinha, alinhamento, espaçamento, largura de imagem, altura de espaçador).
- Todo comando devolve uma nova revisão validada. Os comandos copiam só o caminho até o bloco
  alterado; blocos intocados são compartilhados (congelados) entre revisões, e a validação dos
  seus valores não é refeita.

A saída nunca é editada à mão: o e-mail é gerado em MJML e compilado; a página, em HTML e CSS com
uma classe por bloco. "Converter para HTML editável" transforma uma peça em blocos num documento
HTML; o caminho inverso não existe.

## Quadro de edição

```text
Casca Vue ──postMessage (segredo, revisão, esquema)──▶ iframe sandbox
   ▲                                                    │ runtime do editor
   └───────────── intenções (selecionar, mover, texto) ◀┘
```

O quadro recebe a prévia marcada da revisão atual e um único script autorizado por resumo SHA-256.
O runtime desenha a seleção e as ferramentas numa camada própria (shadow DOM) e só envia
intenções; quem decide é a sessão. Detalhes de segurança em [security.md](security.md).

## Integração

O host fornece, por portas, armazenamento com controle de revisão, biblioteca de imagens, blocos
salvos, catálogo de variáveis e mensagens da interface. No servidor, ele usa
`@lyads/visual-editor/server` para validar e gerar a saída final. Autorização, auditoria,
publicação e envio ficam no host.
