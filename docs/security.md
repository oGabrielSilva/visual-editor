# Segurança para quem integra o editor

O editor recebe conteúdo escrito por pessoas (HTML, CSS, links, texto rico) e o mostra enquanto
elas editam. Este guia diz o que o pacote garante e o que fica com o host.

## O que o pacote garante

### O quadro de edição é isolado

- A peça é mostrada num `iframe` com `sandbox="allow-scripts"`, sem `allow-same-origin`: ele roda
  numa origem opaca e não alcança cookies, armazenamento nem o DOM da página do editor.
- A política de conteúdo do quadro é `default-src 'none'`, e `script-src` aceita só o resumo
  SHA-256 do script do próprio editor. Scripts, handlers inline e endereços `javascript:` do
  autor não rodam dentro do editor.
- O segredo do protocolo entre o editor e o quadro existe só no texto desse script, nunca num
  atributo que o CSS do autor possa ler. Cada mensagem é conferida por origem da janela, segredo,
  revisão e esquema estrito; a cada carga o editor pergunta quem está no quadro.
- Navegação, envio de formulários, `meta refresh` e `<base>` são neutralizados na cópia que o
  quadro mostra.

### E-mails saem sem conteúdo ativo

Ao importar ou salvar um e-mail, o editor remove scripts, documentos incorporados, handlers
(`on…`), endereços de código (`javascript:`, `vbscript:`, `data:` em links), CSS que executa
código, `refresh` e `<base>`, e avisa o autor. O resto, inclusive comentários condicionais do
Outlook e VML, é mantido como foi escrito.

### A compilação MJML no servidor é contida

`createServerEditor` e `createServerBlockToolkit` compilam num worker Node com memória limitada,
tempo-limite que encerra o worker e no máximo dois trabalhos por vez. `mj-include`, `mj-raw`
vindo de fora, configuração `.mjmlconfig` e componentes externos não são aceitos, e a saída é
conferida de novo.

### Peças em blocos são validadas por inteiro

Toda peça (schema 2) é conferida contra o esquema, os tipos de bloco, os limites de tamanho e
profundidade e o validador de cada campo (cores, medidas, listas fechadas, URLs). Valores que
viram CSS nunca podem fechar a regra nem o `<style>`.

## O que fica com o host

### Páginas não são sanitizadas

Por decisão de projeto, uma landing page guarda e publica o HTML e o CSS do autor como foram
escritos, scripts incluídos. `assertSafe` numa página **não** significa "sem script".

Se você publicar a saída de uma página:

- sirva-a numa origem separada da do seu aplicativo (outro domínio ou subdomínio sem os cookies
  de sessão), ou
- sanitize-a antes de servir na mesma origem, ou recuse páginas com conteúdo ativo usando o
  inventário do pacote (`inspect`).

Servir a página do autor na mesma origem do painel, com o cookie de sessão disponível, permite
que um script dela aja em nome de quem a visitar.

### Valide no servidor

O cliente pode ser adulterado. Revalide no servidor tudo que for gravado, com
`@lyads/visual-editor/server`, e gere ali a saída final. Não confie no HTML gerado no navegador.

### Autorização, concorrência e auditoria

Quem pode ver ou editar uma peça, o controle de revisão ao salvar (`expectedRevision`), a
auditoria e a origem das imagens são responsabilidade do host. As portas `store`, `imagePicker`
e `savedBlocks` só recebem e devolvem dados: o editor confere de novo tudo que chega por elas.

## Relatar uma vulnerabilidade

Veja [SECURITY.md](../SECURITY.md).
