/**
 * Documents written the way real tools export them. They are fixtures of the tolerant import:
 * none of them may be refused. Nothing here is fetched or executed by a test.
 */

/** A landing page built by hand over Bootstrap, with the usual marketing tags. */
export const LANDING_PAGE = String.raw`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Curso de Vendas Consultivas</title>
<base target="_blank">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH" crossorigin="anonymous">
<link rel="icon" href="//cdn.example.com/favicon.ico">
<style>
@import url('https://fonts.googleapis.com/css2?family=Lora&display=swap');
@font-face { font-family: "Marca"; src: url(https://cdn.example.com/marca.woff2) format("woff2"); }
/* <!-- comentário antigo --> */
.hero { background: #0d6efd; color: #fff; filter: blur(0); *zoom: 1; }
.hero h1 { font-family: 'Inter', sans-serif; }
</style>
<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-XXXXXXX');</script>
<!-- End Google Tag Manager -->
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Course","name":"Vendas"}</script>
</head>
<body class="bg-light">
<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<header class="hero py-5">
  <div class="container">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" aria-hidden="true"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path fill="url(#g)" d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg>
    <h1 class="display-4">Venda mais com menos esforço</h1>
    <p class="lead">Um método para equipes B2B & consultores.</p>
    <a class="btn btn-light btn-lg" href="javascript:void(0)" onclick="document.getElementById('lead').scrollIntoView()">Quero participar</a>
    <a class="btn btn-link text-white" href="tel:+5511999999999">Ligar agora</a>
    <a class="btn btn-link text-white" href="whatsapp://send?phone=5511999999999">WhatsApp</a>
  </div>
</header>
<main class="container py-5">
  <picture>
    <source type="image/webp" srcset="https://cdn.example.com/a-480.webp 480w, https://cdn.example.com/a-960.webp 960w" sizes="(max-width: 600px) 480px, 960px">
    <img class="img-fluid" src="https://cdn.example.com/a.jpg" srcset="https://cdn.example.com/a.jpg 1x, https://cdn.example.com/a@2x.jpg 2x" alt="Turma em aula">
  </picture>
  <div class="ratio ratio-16x9 my-4">
    <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Apresentação" allowfullscreen></iframe>
  </div>
  <form id="lead" action="https://forms.example.com/submit" method="post" class="row g-3">
    <div class="col-md-6"><input class="form-control" type="email" name="email" placeholder="Seu e-mail" required></div>
    <div class="col-md-6"><button class="btn btn-primary" type="submit">Enviar</button></div>
  </form>
  <template id="linha"><tr><td class="nome"></td><td><script>window.x = 1 < 2;</script></td></tr></template>
  <p id="rodape">Dúvidas? Fale com a gente.</p>
</main>
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" integrity="sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz" crossorigin="anonymous"></script>
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '0000000000');fbq('track', 'PageView');
if (1 < 2 && "</div>".length > 0) { document.title = "<b>ok</b>"; }
</script>
</body>
</html>
`;

/** An export in the style of Mailchimp: merge tags, `mc:edit` regions and old CSS hacks. */
export const EMAIL_MAILCHIMP = String.raw`<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<!--[if gte mso 15]>
<xml>
<o:OfficeDocumentSettings>
<o:AllowPNG/>
<o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings>
</xml>
<![endif]-->
<meta charset="UTF-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>*|MC:SUBJECT|*</title>
<style type="text/css">
p{margin:10px 0;padding:0;}
table{border-collapse:collapse;}
#outlook a{padding:0;}
.ReadMsgBody{width:100%;} .ExternalClass{width:100%;}
.mcnImage{vertical-align:bottom;-ms-interpolation-mode:bicubic;}
@media only screen and (max-width: 480px){ body,table,td,p,a,li,blockquote{-webkit-text-size-adjust:none !important;} }
</style>
</head>
<body leftmargin="0" marginwidth="0" topmargin="0" marginheight="0" offset="0">
<!--*|IF:MC_PREVIEW_TEXT|*-->
<!--[if !gte mso 9]><!----><span class="mcnPreviewText" style="display:none; font-size:0px; line-height:0px; max-height:0px; max-width:0px; opacity:0; overflow:hidden; visibility:hidden; mso-hide:all;">*|MC_PREVIEW_TEXT|*</span><!--<![endif]-->
<!--*|END:IF|*-->
<center>
<table align="center" border="0" cellpadding="0" cellspacing="0" height="100%" width="100%" id="bodyTable">
<tr>
<td align="center" valign="top" id="bodyCell">
<!--[if (gte mso 9)|(IE)]>
<table align="center" border="0" cellspacing="0" cellpadding="0" width="600" style="width:600px;">
<tr>
<td align="center" valign="top" width="600" style="width:600px;">
<![endif]-->
<table border="0" cellpadding="0" cellspacing="0" width="100%" class="templateContainer">
<tr><td valign="top" id="templateHeader" mc:edit="header">
<a href="*|ARCHIVE|*" target="_blank">Ver este e-mail no navegador</a>
<img align="center" alt="" src="https://mcusercontent.com/abc/images/logo.png" width="564" style="max-width:1200px;" class="mcnImage">
</td></tr>
<tr><td valign="top" id="templateBody" mc:edit="body" mc:repeatable="bloco">
<h1>Olá, *|FNAME|*!</h1>
<p>Sua assinatura termina em *|DATE:d/m/y|*. <a href="https://example.com/renovar?email=*|EMAIL|*&utm_source=mc">Renove agora</a>.</p>
*|IF:PLANO=PRO|*<p>Obrigado por ser PRO.</p>*|END:IF|*
</td></tr>
<tr><td valign="top" id="templateFooter" mc:edit="footer">
<em>Copyright &copy; *|CURRENT_YEAR|* *|LIST:COMPANY|*, Todos os direitos reservados.</em><br>
<a href="*|UNSUB|*">Cancelar inscrição</a> &middot; <a href="*|UPDATE_PROFILE|*">Atualizar preferências</a> &middot; <a href="mailto:*|LIST:EMAIL|*">Responder</a>
</td></tr>
</table>
<!--[if (gte mso 9)|(IE)]>
</td>
</tr>
</table>
<![endif]-->
</td>
</tr>
</table>
</center>
</body>
</html>
`;

/** Output in the style of MJML, with web fonts by `<link>` and `@import` behind conditionals. */
export const EMAIL_MJML = String.raw`<!doctype html>
<html lang="pt-BR" dir="auto" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<title>Novidades de novembro</title>
<!--[if !mso]><!-->
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<!--<![endif]-->
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style type="text/css">
#outlook a { padding:0; }
body { margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%; }
table, td { border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt; }
img { border:0;height:auto;line-height:100%; outline:none;text-decoration:none;-ms-interpolation-mode:bicubic; }
</style>
<!--[if mso]>
<noscript>
<xml>
<o:OfficeDocumentSettings>
<o:AllowPNG/>
<o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings>
</xml>
</noscript>
<![endif]-->
<!--[if lte mso 11]>
<style type="text/css">
.mj-outlook-group-fix { width:100% !important; }
</style>
<![endif]-->
<!--[if !mso]><!-->
<link href="https://fonts.googleapis.com/css?family=Roboto:300,400,500,700" rel="stylesheet" type="text/css">
<style type="text/css">
@import url(https://fonts.googleapis.com/css?family=Roboto:300,400,500,700);
</style>
<!--<![endif]-->
<style type="text/css">
@media only screen and (min-width:480px) { .mj-column-per-100 { width:100% !important; max-width: 100%; } }
</style>
</head>
<body style="word-spacing:normal;background-color:#f4f4f4;">
<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">Tudo que mudou este mês</div>
<div style="background-color:#f4f4f4;" lang="pt-BR" dir="auto">
<!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#ffffff" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
<div style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
<table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;background-color:#ffffff;width:100%;">
<tbody><tr><td style="direction:ltr;font-size:0px;padding:20px 0;text-align:center;">
<!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
<div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"><tbody>
<tr><td align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;">
<div style="font-family:Roboto, Helvetica, Arial, sans-serif;font-size:16px;line-height:24px;text-align:left;color:#333333;">Olá {{ contact.first_name | default: "cliente" }}, veja as novidades.</div>
</td></tr>
<tr><td align="center" vertical-align="middle" style="font-size:0px;padding:10px 25px;word-break:break-word;">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;"><tbody><tr>
<td align="center" bgcolor="#0d766e" role="presentation" style="border:none;border-radius:3px;cursor:auto;mso-padding-alt:10px 25px;background:#0d766e;" valign="middle">
<a href="{{ view_url }}" style="display:inline-block;background:#0d766e;color:#ffffff;font-family:Roboto, Helvetica, Arial, sans-serif;font-size:13px;line-height:120%;margin:0;text-decoration:none;padding:10px 25px;mso-padding-alt:0px;border-radius:3px;" target="_blank">Ler no navegador</a>
</td></tr></tbody></table>
</td></tr>
</tbody></table>
</div>
<!--[if mso | IE]></td></tr></table><![endif]-->
</td></tr></tbody>
</table>
</div>
<!--[if mso | IE]></td></tr></table><![endif]-->
</div>
</body>
</html>
`;

/**
 * Written by hand for Outlook: VML, downlevel-revealed conditionals, IE filters, a legacy
 * charset declaration, merge tags of several tools and a script with a handler left behind.
 */
export const EMAIL_HANDMADE = String.raw`<?xml version="1.0" encoding="iso-8859-1"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1" />
<meta name="format-detection" content="telephone=no" />
<title>Oferta de fim de ano</title>
<style type="text/css">
<!--
body { margin:0; padding:0; }
.btn { *zoom:1; _height:1%; filter:progid:DXImageTransform.Microsoft.gradient(startColorstr='#ff0d766e', endColorstr='#ff0a5c56'); }
-->
</style>
<script type="text/javascript">window.onload = function () { track('aberto'); };</script>
</head>
<body bgcolor="#f2f2f2" onload="track('body')">
<!--[if gte mso 9]>
<v:background xmlns:v="urn:schemas-microsoft-com:vml" fill="t">
<v:fill type="tile" src="https://cdn.example.com/fundo.png" color="#f2f2f2"/>
</v:background>
<![endif]-->
<table width="100%" border="0" cellspacing="0" cellpadding="0">
<tr>
<td align="center" background="https://cdn.example.com/fundo.png" style="filter:progid:DXImageTransform.Microsoft.AlphaImageLoader(src='https://cdn.example.com/fundo.png', sizingMethod='scale');">
<![if !mso]>
<table width="600" border="0" cellspacing="0" cellpadding="0" class="so-web"><tr><td>Versão para os demais clientes</td></tr></table>
<![endif]>
<table width="600" border="0" cellspacing="0" cellpadding="0">
<tr>
<td style="font-family:Arial, sans-serif; font-size:16px; mso-line-height-rule:exactly; line-height:24px;">
<p>Olá %%first_name%%, sua oferta chegou.</p>
{% if contact.vip %}<p>Condição especial para clientes VIP.</p>{% endif %}
<img src="{{logo}}" width="120" alt="Logo" onclick="track('logo')" />
<img src="//cdn.example.com/banner.jpg" srcset="//cdn.example.com/banner.jpg 1x, //cdn.example.com/banner@2x.jpg 2x" width="600" alt="Banner" />
</td>
</tr>
<tr>
<td align="center">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="https://example.com/oferta" style="height:40px;v-text-anchor:middle;width:200px;" arcsize="10%" stroke="f" fillcolor="#0d766e">
<w:anchorlock/>
<center style="color:#ffffff;font-family:sans-serif;font-size:13px;font-weight:bold;">Ver oferta</center>
</v:roundrect>
<![endif]-->
<![if !mso]>
<a class="btn" href="https://example.com/oferta" style="background-color:#0d766e;color:#ffffff;display:inline-block;line-height:40px;width:200px;">Ver oferta</a>
<![endif]>
</td>
</tr>
<tr>
<td style="font-size:12px;">
<a href="tel:+551140028922">(11) 4002-8922</a> | <a href="sms:+5511999999999">SMS</a> | <a href="whatsapp://send?phone=5511999999999">WhatsApp</a><br />
<a href="{{ unsubscribe_url }}">Descadastrar</a> | <a href="mailto:{{contact.email}}">Meu e-mail</a> | <a href="%%unsubscribe%%">Sair</a> | <a href="*|UNSUB|*">Sair da lista</a>
<a href="javascript:void(0)">Topo</a>
</td>
</tr>
</table>
</td>
</tr>
</table>
<form action="https://example.com/pesquisa" method="get"><input type="text" name="q" /></form>
<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="5" onclick="x()"/><script>y()</script></svg>
</body>
</html>
`;
