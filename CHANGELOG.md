# Changelog

## 1.0.3

- Porta opcional `formPreview`: o host entrega uma prévia estática de cada formulário conectado e
  o quadro a mostra dentro da caixa do formulário. A prévia é inerte, sem scripts nem ações, e
  nunca entra no documento, na exportação ou no modo HTML.
- Salvar não desativa mais a barra e o painel: só o botão espera, com indicador de carregamento,
  e a edição continua enquanto o host grava.

## 1.0.2

- Publicação pelo GitHub Actions com Trusted Publishing e proveniência do npm.
- A geração antes de empacotar usa o Yarn do próprio repositório, sem depender do Yarn global.
- Sem mudança de comportamento no editor.

## 1.0.1

Primeira versão pública.

- Editor de documentos HTML (schema 1) com modo visual e modo código sobre o mesmo histórico,
  importação tolerante e preservação do HTML não reconhecido.
- Peças em blocos (schema 2) com estilos globais, painel de propriedades gerado das definições,
  saída MJML para e-mail e HTML/CSS para página, e conversão para documento HTML.
- Edição de texto no lugar, teclado, arraste com linha de inserção, ferramentas de imagem.
- Valores só do celular, ocultar por dispositivo e ordem invertida de colunas.
- Conferência antes de enviar, prévia escura aproximada e variáveis como etiqueta.
- Modelos em português, inglês e espanhol; blocos salvos pelo host.
- Kit de servidor para validar peças e compilar MJML num worker Node contido.
