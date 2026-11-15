import { CssDocumentCodec } from '../codecs/css';
import { EditorDocument } from '../core/document';
import type { DocumentKind, DocumentNode, EditorDocumentData } from '../core/document';
import { ActiveMarkupRules } from './markup-rules';
import { isConditionalComment, SOURCE_CONTEXTS, SourceMarkup } from './source-markup';
import type { SourceContext } from './source-markup';

/** A resource the document points to. `origin` is absent for relative URLs and merge tags. */
export interface ExternalReference {
  readonly url: string;
  readonly origin?: string;
}

/**
 * What a document contains that a publisher may want to decide about. The package reports;
 * the host applies its own rule. Counts include markup kept as source (conditional comments,
 * `noscript`, `template`, inline SVG).
 */
export interface ContentInventory {
  readonly kind: DocumentKind;
  readonly scripts: {
    /** Executable scripts written in the document. */
    readonly inline: number;
    /** Executable scripts loaded by `src`. */
    readonly external: readonly ExternalReference[];
    /** `<script>` data blocks such as JSON-LD, which browsers do not run. */
    readonly data: number;
  };
  /** `iframe` and `frame` sources. */
  readonly frames: readonly ExternalReference[];
  /** `object`, `embed` and `applet` elements. */
  readonly embeds: number;
  /** `<link rel="stylesheet">` and `@import` targets. */
  readonly stylesheets: readonly ExternalReference[];
  /** Every other `<link>`: fonts preconnect, icons, preloads. */
  readonly links: readonly (ExternalReference & { readonly rel: string })[];
  readonly forms: { readonly count: number; readonly actions: readonly ExternalReference[] };
  /** `on*` attributes. */
  readonly inlineHandlers: number;
  /** `javascript:`, `vbscript:` and `data:` document URLs in attributes. */
  readonly scriptUrls: number;
  readonly metaRefresh: number;
  readonly baseUrls: readonly string[];
  /** Encodings declared by `<meta>`, lower case, as written. */
  readonly charsets: readonly string[];
  readonly fontFaces: number;
  /** `expression()`, `behavior`, `-moz-binding` and code URLs inside CSS. */
  readonly activeCss: number;
}

export type InventoryTopic = 'script' | 'embed' | 'stylesheet' | 'form' | 'handler' | 'charset';

export interface ContentSurvey {
  readonly inventory: ContentInventory;
  /** First document node of each topic, for a notice which can point at it. */
  readonly anchors: Readonly<Partial<Record<InventoryTopic, string>>>;
}

const EXECUTABLE_TYPES: ReadonlySet<string> = new Set([
  '',
  'module',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'text/ecmascript',
  'application/ecmascript',
  'text/jscript',
  'text/livescript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/x-javascript',
  'text/x-ecmascript',
]);

interface Tally {
  inline: number;
  data: number;
  external: ExternalReference[];
  frames: ExternalReference[];
  embeds: number;
  stylesheets: ExternalReference[];
  links: (ExternalReference & { rel: string })[];
  forms: number;
  actions: ExternalReference[];
  inlineHandlers: number;
  scriptUrls: number;
  metaRefresh: number;
  baseUrls: string[];
  charsets: string[];
  fontFaces: number;
  activeCss: number;
  anchors: Partial<Record<InventoryTopic, string>>;
}

/** Builds the typed inventory of a document. It never changes or refuses anything. */
export class ContentInspector {
  readonly #css: CssDocumentCodec;
  readonly #rules: ActiveMarkupRules;
  readonly #sources: SourceMarkup;

  constructor(css: CssDocumentCodec, rules: ActiveMarkupRules, sources = new SourceMarkup(rules)) {
    this.#css = css;
    this.#rules = rules;
    this.#sources = sources;
  }

  inspect(input: EditorDocumentData): ContentInventory {
    return this.survey(EditorDocument.from(input).snapshot()).inventory;
  }

  /** The caller hands in a snapshot which already passed `EditorDocument.from`. */
  survey(document: EditorDocumentData): ContentSurvey {
    const tally: Tally = {
      inline: 0,
      data: 0,
      external: [],
      frames: [],
      embeds: 0,
      stylesheets: [],
      links: [],
      forms: 0,
      actions: [],
      inlineHandlers: 0,
      scriptUrls: 0,
      metaRefresh: 0,
      baseUrls: [],
      charsets: [],
      fontFaces: 0,
      activeCss: 0,
      anchors: {},
    };
    this.stylesheet(document.css, tally, undefined);
    const stack = [...document.nodes].reverse();
    while (stack.length) {
      const node = stack.pop();
      if (!node) break;
      if (node.type === 'comment' && this.conditional(node.value ?? ''))
        this.source(node.value ?? '', 'html', tally, node.id);
      if (node.type !== 'element') continue;
      const tag = (node.tag ?? '').toLowerCase();
      const text = this.text(node);
      this.element(tag, node.attrs ?? {}, text, tally, node.id);
      if (tag === 'style') this.stylesheet(text, tally, node.id);
      const context = SOURCE_CONTEXTS[tag];
      if (context) this.source(text, context, tally, node.id);
      const children = node.children ?? [];
      for (let index = children.length - 1; index >= 0; index--) {
        const child = children[index];
        if (child) stack.push(child);
      }
    }
    return {
      anchors: tally.anchors,
      inventory: {
        kind: document.kind,
        scripts: { inline: tally.inline, external: tally.external, data: tally.data },
        frames: tally.frames,
        embeds: tally.embeds,
        stylesheets: tally.stylesheets,
        links: tally.links,
        forms: { count: tally.forms, actions: tally.actions },
        inlineHandlers: tally.inlineHandlers,
        scriptUrls: tally.scriptUrls,
        metaRefresh: tally.metaRefresh,
        baseUrls: tally.baseUrls,
        charsets: tally.charsets,
        fontFaces: tally.fontFaces,
        activeCss: tally.activeCss,
      },
    };
  }

  /** A conditional comment hides markup which Outlook, or an old browser, does render. */
  conditional(value: string): boolean {
    return isConditionalComment(value);
  }

  private source(text: string, context: SourceContext, tally: Tally, owner: string): void {
    for (const element of this.#sources.elements(text, context)) {
      const tag = element.tag.toLowerCase();
      this.element(tag, element.attrs, element.text, tally, owner);
      if (tag === 'style') this.stylesheet(element.text, tally, owner);
    }
  }

  private element(
    tag: string,
    attributes: Readonly<Record<string, string>>,
    text: string,
    tally: Tally,
    owner: string,
  ): void {
    const attrs: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [name, value] of Object.entries(attributes)) attrs[name.toLowerCase()] = value;
    const mark = (topic: InventoryTopic): void => {
      tally.anchors[topic] ??= owner;
    };
    const active = this.#rules.element(tag);
    // A refresh to a code address or an animation which writes one into a link is a code URL.
    if (this.#rules.elementWith(tag, attributes) === 'url') {
      tally.scriptUrls++;
      mark('handler');
    }
    if (active === 'script') {
      const type = (attrs.type ?? '').trim().toLowerCase().split(';', 1)[0] ?? '';
      if (!EXECUTABLE_TYPES.has(type.trim())) tally.data++;
      else {
        if (attrs.src !== undefined) tally.external.push(this.reference(attrs.src));
        else if (text.trim()) tally.inline++;
        mark('script');
      }
    } else if (active === 'embed') {
      if (tag === 'iframe' || tag === 'frame') tally.frames.push(this.reference(attrs.src ?? ''));
      else tally.embeds++;
      mark('embed');
    }
    if (tag === 'link') {
      const rel = (attrs.rel ?? '').trim().toLowerCase();
      const reference = this.reference(attrs.href ?? '');
      if (rel.split(/\s+/).includes('stylesheet')) {
        tally.stylesheets.push(reference);
        mark('stylesheet');
      } else tally.links.push({ ...reference, rel });
    }
    if (tag === 'form') {
      tally.forms++;
      if (attrs.action !== undefined) tally.actions.push(this.reference(attrs.action));
      mark('form');
    }
    if (tag === 'base' && attrs.href !== undefined) tally.baseUrls.push(attrs.href);
    if (tag === 'meta') {
      const charset = this.declaredCharset(attrs);
      if (charset !== undefined) {
        tally.charsets.push(charset);
        if (charset !== 'utf-8') mark('charset');
      }
      if ((attrs['http-equiv'] ?? '').trim().toLowerCase() === 'refresh') tally.metaRefresh++;
    }
    for (const [name, value] of Object.entries(attrs)) {
      const finding = this.#rules.attribute(name, value);
      if (finding === 'handler') tally.inlineHandlers++;
      if (finding === 'url') tally.scriptUrls++;
      if (finding) mark('handler');
      if (name === 'style' && this.mayBeActive(value))
        tally.activeCss += this.#css.survey(value, 'declarationList').active;
    }
  }

  /**
   * Most inline styles are plain declarations. Only one which could hold what the survey
   * counts (a URL, a legacy expression or binding, or an escape hiding either) is parsed.
   */
  private mayBeActive(style: string): boolean {
    const value = style.toLowerCase();
    return ['url', 'expression', 'behavior', 'binding', '\\'].some((hint) => value.includes(hint));
  }

  private stylesheet(css: string, tally: Tally, owner: string | undefined): void {
    const survey = this.#css.survey(css);
    tally.fontFaces += survey.fontFaces;
    tally.activeCss += survey.active;
    for (const target of survey.imports) {
      tally.stylesheets.push(this.reference(target));
      if (owner) tally.anchors.stylesheet ??= owner;
    }
  }

  /** The encoding a `<meta>` declares, by either syntax; undefined when it declares none. */
  declaredCharset(attrs: Readonly<Record<string, string>>): string | undefined {
    if (attrs.charset !== undefined) return attrs.charset.trim().toLowerCase();
    if ((attrs['http-equiv'] ?? '').trim().toLowerCase() !== 'content-type') return undefined;
    for (const part of (attrs.content ?? '').split(';')) {
      const [name, value] = part.split('=');
      if (name?.trim().toLowerCase() === 'charset' && value !== undefined)
        return value.trim().toLowerCase();
    }
    return undefined;
  }

  private reference(url: string): ExternalReference {
    const value = url.trim();
    try {
      const parsed = new URL(value.startsWith('//') ? `https:${value}` : value);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:'
        ? { url: value, origin: parsed.origin }
        : { url: value };
    } catch {
      return { url: value };
    }
  }

  private text(node: DocumentNode): string {
    return (node.children ?? [])
      .map((child) => (child.type === 'text' ? (child.value ?? '') : ''))
      .join('');
  }
}
