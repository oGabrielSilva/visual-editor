import { BlockDocument, LANGUAGE_TAG_PATTERN } from '../../core/block-document';
import type { Block, BlockRules } from '../../core/block-document';
import type { DocumentKind } from '../../core/document';
import emailBlank from './email-blank.json';
import emailNewsletter from './email-newsletter.json';
import emailWelcome from './email-welcome.json';
import pageEvent from './page-event.json';
import pageMaterial from './page-material.json';

export interface BlockTemplateDescriptor {
  readonly id: string;
  readonly kind: DocumentKind;
  readonly titleKey: string;
  readonly descriptionKey: string;
}

const TEMPLATES: readonly unknown[] = [
  emailBlank,
  emailNewsletter,
  emailWelcome,
  pageMaterial,
  pageEvent,
];

/** Languages a template is written in besides its own (pt-BR): the texts of its blocks by id. */
export const TEMPLATE_LANGUAGES = ['en', 'es'] as const;
type TemplateLanguage = (typeof TEMPLATE_LANGUAGES)[number];

interface TemplateEntry extends BlockTemplateDescriptor {
  readonly document: { readonly title: string; readonly meta: unknown; readonly styles: unknown };
  readonly blocks: readonly Block[];
  readonly translations: Readonly<
    Partial<Record<TemplateLanguage, Readonly<Record<string, string>>>>
  >;
}

/** The template language of a language tag: `en-US` reads the English texts. */
function templateLanguage(tag: string | undefined): TemplateLanguage | undefined {
  const base = tag?.toLowerCase().split('-')[0];
  return TEMPLATE_LANGUAGES.find((language) => language === base);
}

/**
 * Starting points of block pieces (schema 2), stored as JSON. They sit beside the schema 1
 * models of `TemplateCatalog`, which stay as they are. A piece made from a template gets new
 * block ids, so two pieces never share them.
 */
export class BlockTemplateCatalog {
  readonly #entries: readonly TemplateEntry[];

  constructor(private readonly rules: BlockRules) {
    this.#entries = TEMPLATES.map((template) => this.entry(template));
  }

  list(kind: DocumentKind): readonly BlockTemplateDescriptor[] {
    return this.#entries
      .filter((entry) => entry.kind === kind)
      .map(({ id, kind: entryKind, titleKey, descriptionKey }) =>
        Object.freeze({ id, kind: entryKind, titleKey, descriptionKey }),
      );
  }

  /** The blank piece of a kind: one section, one column, one text (a page has the same). */
  blank(
    kind: DocumentKind,
    documentId: string,
    nextId: () => string,
    language?: string,
  ): BlockDocument {
    return this.create('email-blank', documentId, nextId, kind, language);
  }

  /**
   * A new piece from a template, in the language given (pt-BR, English or Spanish texts; any
   * other language keeps pt-BR). The piece declares the language of its texts.
   */
  create(
    id: string,
    documentId: string,
    nextId: () => string,
    kind?: DocumentKind,
    language?: string,
  ): BlockDocument {
    const entry = this.#entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error('template.not_found');
    const translated = templateLanguage(language);
    const texts = translated ? entry.translations[translated] : undefined;
    const lang = texts && language && LANGUAGE_TAG_PATTERN.test(language) ? language : undefined;
    return BlockDocument.from(
      {
        schemaVersion: 2,
        id: documentId,
        kind: kind ?? entry.kind,
        revision: 0,
        title: entry.document.title,
        meta: lang ? { lang } : entry.document.meta,
        styles: entry.document.styles,
        blocks: entry.blocks.map((block) => this.reidentify(block, nextId, texts)),
      },
      this.rules,
    );
  }

  private reidentify(
    block: Block,
    nextId: () => string,
    texts?: Readonly<Record<string, string>>,
  ): Block {
    const text = texts?.[block.id];
    return {
      id: nextId(),
      type: block.type,
      props: { ...block.props, ...(text !== undefined ? { text } : {}) },
      ...(block.children
        ? { children: block.children.map((child) => this.reidentify(child, nextId, texts)) }
        : {}),
    };
  }

  private entry(template: unknown): TemplateEntry {
    // Validated once with the template's own ids, so a broken template fails at start-up.
    const value = template as {
      id: string;
      kind: DocumentKind;
      titleKey: string;
      descriptionKey: string;
      document: { title: string; meta: unknown; styles: unknown; blocks: unknown };
      translations?: Partial<Record<TemplateLanguage, Record<string, string>>>;
    };
    const document = BlockDocument.from(
      {
        schemaVersion: 2,
        id: value.id,
        kind: value.kind,
        revision: 0,
        title: value.document.title,
        meta: value.document.meta,
        styles: value.document.styles,
        blocks: value.document.blocks,
      },
      this.rules,
    );
    // Each translation names a block of the template with a text and passes its rules: a piece
    // in another language is built and validated here once.
    const translations = value.translations ?? {};
    for (const [language, texts] of Object.entries(translations)) {
      if (!templateLanguage(language)) throw new Error('template.invalid_translation');
      let translated = document;
      for (const [blockId, text] of Object.entries(texts ?? {})) {
        if (typeof translated.find(blockId)?.props.text !== 'string')
          throw new Error('template.invalid_translation');
        translated = translated.updateText(blockId, 'text', text);
      }
    }
    return {
      id: value.id,
      kind: value.kind,
      titleKey: value.titleKey,
      descriptionKey: value.descriptionKey,
      document: { title: document.title, meta: document.meta, styles: document.styles },
      blocks: document.blocks,
      translations,
    };
  }
}
