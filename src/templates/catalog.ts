import type { DocumentKind, SourceInput } from '../core/document';
import type { MjmlEmailRenderer } from '../renderers/email-renderer';
import { BLANK_EMAIL_HTML } from './blank-email';

/** A block source; e-mail blocks state whether they are a content row or a whole section. */
export interface BlockSource extends SourceInput {
  readonly insertion?: 'content' | 'section';
}

export interface TemplateDescriptor {
  readonly id: string;
  readonly kind: DocumentKind;
  readonly titleKey: string;
  readonly descriptionKey: string;
}

interface TemplateDefinition extends TemplateDescriptor {
  readonly source: string;
  readonly css?: string;
}

// A title and a preheader reach the recipient: models are born without sample ones. They
// are set through the document metadata commands of the session.
const EMAIL_STYLE = `<mj-head><mj-breakpoint width="641px" /><mj-attributes><mj-all font-family="Arial, sans-serif" /><mj-text color="#243746" line-height="1.65" font-size="16px" /><mj-button background-color="#0d766e" border-radius="8px" font-size="16px" /></mj-attributes></mj-head>`;
// Blocks are fragments of a message: they carry neither a title nor a preheader of their own.
const EMAIL_BLOCK_STYLE = `<mj-head><mj-breakpoint width="641px" /><mj-attributes><mj-all font-family="Arial, sans-serif" /><mj-text color="#243746" line-height="1.65" font-size="16px" /><mj-button background-color="#0d766e" border-radius="8px" font-size="16px" /></mj-attributes></mj-head>`;
const EMAIL_SECTION_BLOCKS: ReadonlySet<string> = new Set(['section', 'columns', 'footer']);
const EMAIL_FOOTER = `<mj-section><mj-column><mj-divider border-color="#dce4e7" /><mj-text font-size="12px" color="#536674">Mensagem de exemplo. O rodapé de envio é fornecido pelo aplicativo.</mj-text></mj-column></mj-section>`;
const PAGE_CSS = `:root{font-family:Arial,sans-serif;color:#16302e;background:#f7faf9}*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:auto;padding:40px 24px}section{padding:48px 0}h1{font-size:clamp(2.3rem,6vw,4.2rem);line-height:1.08;letter-spacing:-.045em;max-width:850px}h2{font-size:2rem;letter-spacing:-.025em}p{line-height:1.7;max-width:720px}a.cta{display:inline-block;padding:14px 22px;background:#0d766e;color:white;text-decoration:none;border-radius:8px;font-weight:600}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:12px}.columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.card{border:1px solid #d5e3df;border-radius:12px;padding:24px;background:white}img{max-width:100%;height:auto}details{border-bottom:1px solid #d5e3df;padding:18px 0}summary{cursor:pointer;font-weight:600}footer{border-top:1px solid #d5e3df;padding:28px 0;color:#526b65}.host-form{min-height:96px;padding:24px;border:1px dashed #6e9187;border-radius:12px;background:#edf5f1}@media(max-width:640px){main{padding:24px 16px}.columns{grid-template-columns:1fr}section{padding:28px 0}}`;
const BLOCK_CSS = `[data-editor-block="hero"]{padding:48px 24px}[data-editor-block="hero"]>h1{font-size:clamp(2.3rem,6vw,4.2rem);line-height:1.08;letter-spacing:-.045em}[data-editor-block="hero"]>p{line-height:1.7}[data-editor-block="hero"]>.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:12px}[data-editor-block="hero"]>.cta,[data-editor-block="button"]{display:inline-block;padding:14px 22px;background:#0d766e;color:white;text-decoration:none;border-radius:8px;font-weight:600}[data-editor-block="columns"]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;padding:24px}[data-editor-block="columns"]>.card{border:1px solid #d5e3df;border-radius:12px;padding:24px;background:white;min-width:0}[data-editor-block="text"]{line-height:1.7}[data-editor-block="heading"]{font-size:2rem;letter-spacing:-.025em}[data-editor-block="image"]>img{max-width:100%;height:auto}[data-editor-block="faq"]{padding:24px}[data-editor-block="faq"]>details{border-bottom:1px solid #d5e3df;padding:18px 0}[data-editor-block="faq"]>details>summary{cursor:pointer;font-weight:600}[data-editor-block="footer"]{border-top:1px solid #d5e3df;padding:28px 24px;color:#526b65}[data-editor-block="form"]{padding:24px}[data-editor-block="form"]>.host-form{min-height:96px;padding:24px;border:1px dashed #6e9187;border-radius:12px;background:#edf5f1}@media(max-width:640px){[data-editor-block="columns"]{grid-template-columns:1fr}[data-editor-block="hero"]{padding:28px 16px}}`;

const DEFINITIONS: readonly TemplateDefinition[] = [
  {
    id: 'email-newsletter',
    kind: 'email',
    titleKey: 'templates.newsletter',
    descriptionKey: 'templates.newsletterDescription',
    source: `<mjml>${EMAIL_STYLE}<mj-body background-color="#f3f7f6" width="600px"><mj-section background-color="#ffffff" padding="32px"><mj-column><mj-text font-size="12px" color="#0d766e">NOVIDADES</mj-text><mj-text font-size="30px" font-weight="700">Olá, Nico Robin</mj-text><mj-text>Reunimos as novidades para sua próxima conversa. Edite esta mensagem antes de enviar.</mj-text><mj-divider border-color="#dce4e7" /><mj-text font-size="22px" font-weight="700">O destaque do mês</mj-text><mj-text>Conte uma novidade relevante e convide as pessoas a conhecer mais.</mj-text><mj-button href="https://example.com/novidades">Conhecer as novidades</mj-button></mj-column></mj-section>${EMAIL_FOOTER}</mj-body></mjml>`,
  },
  {
    id: 'email-welcome',
    kind: 'email',
    titleKey: 'templates.welcome',
    descriptionKey: 'templates.welcomeDescription',
    source: `<mjml>${EMAIL_STYLE}<mj-body background-color="#f3f7f6"><mj-section background-color="#ffffff" padding="32px"><mj-column><mj-text font-size="12px" color="#0d766e">BOAS-VINDAS</mj-text><mj-text font-size="30px" font-weight="700">Uma nova conversa começa aqui</mj-text><mj-text>Olá, Nico Robin. Obrigado pelo interesse. Veja como dar o próximo passo.</mj-text><mj-button href="https://example.com/comecar">Começar agora</mj-button></mj-column></mj-section><mj-section background-color="#ffffff"><mj-column><mj-text font-weight="700">1. Conheça a proposta</mj-text><mj-text>Encontre o que você precisa.</mj-text></mj-column><mj-column><mj-text font-weight="700">2. Fale com a equipe</mj-text><mj-text>Escolha o melhor momento.</mj-text></mj-column></mj-section>${EMAIL_FOOTER}</mj-body></mjml>`,
  },
  {
    id: 'email-announcement',
    kind: 'email',
    titleKey: 'templates.announcement',
    descriptionKey: 'templates.announcementDescription',
    source: `<mjml>${EMAIL_STYLE}<mj-body background-color="#f3f7f6"><mj-section background-color="#ffffff" padding="32px"><mj-column><mj-text font-size="12px" color="#0d766e">COMUNICADO</mj-text><mj-text font-size="30px" font-weight="700">Temos uma novidade para compartilhar</mj-text><mj-text>Explique a novidade, para quem ela é relevante e o próximo passo.</mj-text><mj-spacer height="16px" /><mj-button href="https://example.com/saiba-mais">Saiba mais</mj-button></mj-column></mj-section>${EMAIL_FOOTER}</mj-body></mjml>`,
  },
  {
    id: 'page-material',
    kind: 'page',
    titleKey: 'templates.material',
    descriptionKey: 'templates.materialDescription',
    css: PAGE_CSS,
    source: `<main><section data-editor-block="hero"><p class="eyebrow">MATERIAL GRATUITO</p><h1>Uma ideia para o seu próximo passo</h1><p>Apresente o conteúdo e mostre como ele pode ajudar quem chega até esta página.</p><a class="cta" href="#interesse">Receber o material</a></section><section class="columns" data-editor-block="columns"><article class="card"><h2>O que você vai encontrar</h2><p>Uma apresentação objetiva para transformar interesse em ação.</p></article><article class="card"><h2>Para quem é</h2><p>Descreva a pessoa que mais se beneficia deste conteúdo.</p></article></section><section id="interesse" data-editor-block="form"><h2>Receba o conteúdo</h2><div class="host-form" data-host-slot="form" data-editor-block="form"></div></section><footer data-editor-block="footer">Conteúdo de demonstração. Edite antes de publicar.</footer></main>`,
  },
  {
    id: 'page-service',
    kind: 'page',
    titleKey: 'templates.service',
    descriptionKey: 'templates.serviceDescription',
    css: PAGE_CSS,
    source: `<main><section data-editor-block="hero"><p class="eyebrow">PARA SUA EQUIPE</p><h1>Apresente uma solução para um problema real</h1><p>Conte o que a sua equipe entrega, para quem e como começar.</p><a class="cta" href="#contato">Conversar com a equipe</a></section><section class="columns" data-editor-block="columns"><article class="card"><h2>Clareza em cada etapa</h2><p>Explique o resultado esperado com um exemplo concreto.</p></article><article class="card"><h2>Acompanhamento próximo</h2><p>Mostre como o trabalho acontece na prática.</p></article></section><section data-editor-block="faq"><h2>Perguntas frequentes</h2><details><summary>Como funciona o primeiro contato?</summary><p>A equipe combina o próximo passo de acordo com sua necessidade.</p></details><details><summary>O que preciso para começar?</summary><p>Compartilhe seu objetivo e o contexto da sua operação.</p></details></section><section id="contato" data-editor-block="form"><div class="host-form" data-host-slot="form" data-editor-block="form"></div></section><footer data-editor-block="footer">Conteúdo de demonstração.</footer></main>`,
  },
  {
    id: 'page-event',
    kind: 'page',
    titleKey: 'templates.event',
    descriptionKey: 'templates.eventDescription',
    css: PAGE_CSS,
    source: `<main><section data-editor-block="hero"><p class="eyebrow">ENCONTRO</p><h1>Uma conversa que merece seu tempo</h1><p>Apresente o tema do encontro e o que os participantes vão aprender.</p><a class="cta" href="#inscricao">Quero participar</a></section><section class="columns" data-editor-block="columns"><article class="card"><h2>Uma visão prática</h2><p>Compartilhe ideias que possam ser aplicadas no dia a dia.</p></article><article class="card"><h2>Espaço para perguntas</h2><p>Inclua as principais dúvidas na conversa.</p></article></section><section id="inscricao" data-editor-block="form"><h2>Reserve seu lugar</h2><div class="host-form" data-host-slot="form" data-editor-block="form"></div></section><footer data-editor-block="footer">Conteúdo de demonstração.</footer></main>`,
  },
];

/** The structure a new e-mail starts from: one section, one column, one editable text. */
export const BLANK_EMAIL_MJML = `<mjml>${EMAIL_BLOCK_STYLE}<mj-body width="600px"><mj-section css-class="editor-layout-section"><mj-column css-class="editor-layout-column"><mj-text>Escreva seu conteúdo.</mj-text></mj-column></mj-section></mj-body></mjml>`;

export class TemplateCatalog {
  constructor(private readonly emailRenderer: MjmlEmailRenderer) {}

  list(kind: DocumentKind): readonly TemplateDescriptor[] {
    return DEFINITIONS.filter((entry) => entry.kind === kind).map(
      ({ id, kind: entryKind, titleKey, descriptionKey }) =>
        Object.freeze({ id, kind: entryKind, titleKey, descriptionKey }),
    );
  }

  async create(id: string): Promise<SourceInput> {
    const definition = DEFINITIONS.find((entry) => entry.id === id);
    if (!definition) throw new Error('template.not_found');
    return definition.kind === 'email'
      ? this.emailRenderer.createSource(this.emailLayout(definition.source))
      : { html: definition.source, css: definition.css ?? '' };
  }

  /**
   * The document an editor opens with when it is given none. The e-mail is the compiled
   * `BLANK_EMAIL_MJML`, stored so that an editor can be created synchronously; a test keeps
   * it equal to what the compiler produces. It has the layout of every generated e-mail, so
   * blocks can be inserted above and below its text and moved.
   */
  blank(kind: DocumentKind): SourceInput {
    return kind === 'email'
      ? { html: BLANK_EMAIL_HTML, css: '' }
      : { html: '<p>Escreva seu conteúdo.</p>', css: '' };
  }

  blocks(kind: DocumentKind): readonly string[] {
    return Object.freeze(Object.keys(this.blockDefinitions(kind)));
  }

  async createBlock(type: string, kind: DocumentKind): Promise<BlockSource> {
    const block = this.blockDefinitions(kind)[type];
    if (!block) throw new Error('block.not_supported');
    if (kind !== 'email') return { html: block, css: BLOCK_CSS };
    const source = await this.emailRenderer.createSource(
      this.emailLayout(`<mjml>${EMAIL_BLOCK_STYLE}<mj-body>${block}</mj-body></mjml>`),
    );
    return {
      html: source.html,
      css: source.css,
      insertion: EMAIL_SECTION_BLOCKS.has(type) ? 'section' : 'content',
    };
  }

  private emailLayout(source: string): string {
    return source
      .replaceAll('<mj-section', '<mj-section css-class="editor-layout-section"')
      .replaceAll('<mj-column', '<mj-column css-class="editor-layout-column"');
  }

  private blockDefinitions(kind: DocumentKind): Readonly<Record<string, string>> {
    const emailBlocks: Readonly<Record<string, string>> = {
      section:
        '<mj-section background-color="#ffffff" padding="24px"><mj-column><mj-text>Uma nova seção para sua mensagem.</mj-text></mj-column></mj-section>',
      text: '<mj-section><mj-column><mj-text>Escreva uma mensagem para sua próxima conversa.</mj-text></mj-column></mj-section>',
      heading:
        '<mj-section><mj-column><mj-text><h2 style="margin:0;font-size:28px;line-height:1.3;font-weight:700">Seu próximo título</h2></mj-text></mj-column></mj-section>',
      image:
        '<mj-section><mj-column><mj-image src="https://placehold.co/600x260/png" alt="Imagem de demonstração" /></mj-column></mj-section>',
      button:
        '<mj-section><mj-column><mj-button href="https://example.com">Saiba mais</mj-button></mj-column></mj-section>',
      columns:
        '<mj-section><mj-column><mj-text>Primeira coluna</mj-text></mj-column><mj-column><mj-text>Segunda coluna</mj-text></mj-column></mj-section>',
      divider:
        '<mj-section><mj-column><mj-divider border-color="#dce4e7" /></mj-column></mj-section>',
      spacer: '<mj-section><mj-column><mj-spacer height="24px" /></mj-column></mj-section>',
      footer: EMAIL_FOOTER,
    };
    const pageBlocks: Readonly<Record<string, string>> = {
      section:
        '<section data-editor-block="section" style="padding:24px"><div><h2>Uma nova seção</h2><p>Organize uma parte da sua página.</p></div></section>',
      hero: '<section data-editor-block="hero"><p class="eyebrow">SEU PRÓXIMO PASSO</p><h1>Apresente sua proposta</h1><p>Conte o que você entrega e convide a pessoa a começar.</p><a class="cta" href="https://example.com">Saiba mais</a></section>',
      heading: '<h2 data-editor-block="heading">Seu próximo título</h2>',
      text: '<div data-editor-block="text"><p>Escreva uma mensagem para sua próxima conversa.</p></div>',
      image:
        '<figure data-editor-block="image"><img src="https://placehold.co/800x400/png" alt="Imagem de demonstração"><figcaption>Descreva a imagem.</figcaption></figure>',
      button: '<a data-editor-block="button" class="cta" href="https://example.com">Saiba mais</a>',
      columns:
        '<section class="columns" data-editor-block="columns" style="gap:24px"><article class="card"><h2>Primeira coluna</h2><p>Apresente uma ideia.</p></article><article class="card"><h2>Segunda coluna</h2><p>Apresente outra ideia.</p></article></section>',
      divider: '<hr>',
      spacer: '<div data-editor-block="spacer" style="height:24px"></div>',
      footer: '<footer data-editor-block="footer">Edite as informações do rodapé.</footer>',
      faq: '<section data-editor-block="faq"><h2>Perguntas frequentes</h2><details><summary>Como funciona?</summary><p>Explique o próximo passo.</p></details></section>',
      form: '<section data-editor-block="form"><h2>Comece por aqui</h2><div data-host-slot="form" data-editor-block="form" class="host-form"></div></section>',
    };
    return kind === 'email' ? emailBlocks : pageBlocks;
  }
}
