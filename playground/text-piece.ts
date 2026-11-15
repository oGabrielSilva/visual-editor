/**
 * A text-heavy e-mail piece: one cell with a small call, a title and a paragraph of different
 * sizes and colors, a white-on-color button, a padded cell with loose text and a list. The
 * playground loads it, and the inline-editing tests check that editing keeps its appearance.
 */
export const TEXT_PIECE_HTML = [
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="margin:0 auto;font-family:Arial,sans-serif;background:#ffffff">',
  '<tbody>',
  '<tr><td id="piece-cell" style="padding:24px;background:#f4f7f6">',
  '<p id="piece-eyebrow" style="margin:0 0 8px;font-size:12px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:#0d766e">Chamada da campanha</p>',
  '<h1 id="piece-title" style="margin:0 0 12px;font-size:32px;line-height:38px;font-weight:700;color:#172b28">Título principal da peça</h1>',
  '<p id="piece-text" style="margin:0;font-size:16px;line-height:24px;color:#4b5f5a">Parágrafo de apoio com <strong>destaque</strong> e um <a href="https://example.test/saiba" style="color:#b4472e">link de exemplo</a> dentro do texto, longo o bastante para quebrar em mais de uma linha na largura da peça.</p>',
  '</td></tr>',
  '<tr><td style="padding:16px 24px;text-align:center">',
  '<a id="piece-button" href="https://example.test/acao" style="display:inline-block;padding:12px 28px;background:#0d766e;color:#ffffff;font-size:16px;line-height:20px;font-weight:700;text-decoration:none;border-radius:6px">Quero participar</a>',
  '</td></tr>',
  '<tr><td id="piece-padded" style="padding:20px;font-size:15px;line-height:22px;color:#33413e;background:#eef3f1">Texto solto em uma célula com espaçamento interno de vinte pixels.</td></tr>',
  '<tr><td style="padding:8px 24px 24px">',
  '<ul id="piece-list" style="margin:0;padding-left:20px;font-size:15px;line-height:22px;color:#33413e"><li id="piece-item">Primeiro item da lista</li><li>Segundo item da lista</li></ul>',
  '</td></tr>',
  '<tr><td id="piece-structures" style="padding:8px 24px 24px;font-size:15px;line-height:22px;color:#33413e">',
  '<p id="piece-nested" style="margin:0 0 8px"><span style="color:#666666">Texto cinza com <a href="https://example.test/aninhado" style="color:#0066cc">link azul</a> no meio</span></p>',
  '<p id="piece-boxed" style="margin:0 0 8px"><span style="padding:2px 6px;background:#fff3c4;border:1px solid #e0c060">Destaque com <strong>negrito</strong> dentro</span></p>',
  '<p id="piece-breaks" style="margin:0 0 8px">Linha 1<br>Linha 2<br></p>',
  '<p id="piece-indented" style="margin:0 0 8px">\n        Texto com quebras\n        e indentação do fonte\n      </p>',
  '<p id="piece-code" style="margin:0"><a href="https://example.test/codigo"><code>x</code></a> código dentro de link</p>',
  '</td></tr>',
  '</tbody>',
  '</table>',
].join('');
