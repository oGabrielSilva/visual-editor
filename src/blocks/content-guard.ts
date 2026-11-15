import { parseFragment, serialize } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { BlockDocumentError } from '../core/block-document';
import type { DocumentKind, DocumentNode, EditorDocumentData } from '../core/document';
import { isReservedAttribute } from '../core/canvas-contract';
import { HtmlDocumentCodec } from '../codecs/html';
import { CssDocumentCodec } from '../codecs/css';
import { ContentPolicy } from '../security/policy';
import { RichTextProjection } from '../security/rich-text-projection';
import { UrlPolicy } from '../security/url-policy';
import type { UrlPurpose } from '../security/url-policy';
import { sha256Base64 } from '../security/sha256';
import { RichTextMarkup } from '../core/rich-text-markup';
import type { RichTextMode } from '../core/rich-text-markup';

const HTML_LIMITS: Readonly<Record<DocumentKind, number>> = Object.freeze({
  // Kept under the compilation ceiling of a whole e-mail.
  email: 150_000,
  page: 500_000,
});
const CACHE_SIZE = 2_000;
/** `plaintext` swallows everything after it, closing tags included, in either kind. */
const PAGE_FORBIDDEN_TAGS: ReadonlySet<string> = new Set(['plaintext']);
/** An e-mail also loses what redirects it and what renders markup as text. */
const EMAIL_FORBIDDEN_TAGS: ReadonlySet<string> = new Set([
  'plaintext',
  'xmp',
  'listing',
  'meta',
  'base',
]);
const CLASS_ATTRIBUTE = /class\s*=\s*["']?/gi;
const GENERATED_PREFIX = /\bve-/i;

/**
 * Whether markup kept as text (a comment, a conditional comment) writes a generated class,
 * `class="… ve-…"`. Linear in the length of the text: each attribute value is read once up to
 * its closing quote or `>`, and a `class=` inside a value already read is skipped (a value it
 * starts has the same end, so it cannot hold a match the longer one did not).
 */
function writesGeneratedClass(text: string): boolean {
  let scannedTo = 0;
  for (const match of text.matchAll(CLASS_ATTRIBUTE)) {
    const start = match.index + match[0].length;
    if (start < scannedTo) continue;
    let end = start;
    while (end < text.length) {
      const character = text[end];
      if (character === '"' || character === "'" || character === '>') break;
      end++;
    }
    if (GENERATED_PREFIX.test(text.slice(start, end))) return true;
    scannedTo = end;
  }
  return false;
}
const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com/';
const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com/';

/**
 * The content rules of the texts, links and free HTML a block carries. A text is the rich
 * text projection the in-place editing protocol already transports: it is accepted only when
 * it is a fixed point of `RichTextProjection`, imports without any notice other than `info`,
 * is writable under `ContentPolicy.writable` and uses only the tags and attributes of its
 * mode. A free HTML block of an e-mail is refused when the e-mail rules would remove anything.
 */
export class BlockContentGuard {
  readonly #urls: UrlPolicy;
  readonly #policy: ContentPolicy;
  readonly #codec: HtmlDocumentCodec;
  readonly #css: CssDocumentCodec;
  readonly #projection: RichTextProjection;
  readonly #cache = new Map<string, boolean>();
  readonly #markup = new RichTextMarkup();

  constructor(urls = new UrlPolicy()) {
    this.#urls = urls;
    this.#css = new CssDocumentCodec(urls);
    this.#policy = new ContentPolicy(urls, this.#css);
    this.#codec = new HtmlDocumentCodec(this.#policy);
    this.#projection = new RichTextProjection(urls);
  }

  acceptsUrl(value: string, purpose: UrlPurpose): boolean {
    return this.#urls.isSafe(value, purpose);
  }

  /** The settled projection of a text; throws `INVALID_BLOCK_TEXT` when it has none. */
  normalizeText(value: string, mode: RichTextMode, kind: DocumentKind): string {
    void kind;
    try {
      const projected = this.#projection.project(value, mode === 'block').html;
      return mode === 'block' ? projected : this.flatten(projected, mode === 'button');
    } catch {
      throw new BlockDocumentError('INVALID_BLOCK_TEXT');
    }
  }

  acceptsText(value: string, mode: RichTextMode, kind: DocumentKind): boolean {
    if (value === '') return true;
    return this.cached(`t\u0000${kind}\u0000${mode}`, value, () => {
      let settled: string;
      try {
        settled = this.normalizeText(value, mode, kind);
      } catch {
        return false;
      }
      if (settled !== value) return false;
      const nodes = this.inspected(value, kind)?.nodes;
      return !!nodes && this.#policy.writable(nodes) && this.projectionNodes(nodes, mode);
    });
  }

  /** Balanced markup as the parser reads it back; nothing is removed here. */
  normalizeHtml(value: string): string {
    const imported = this.#codec.inspect({ html: value, css: '' }, 'page');
    if (!imported.document) throw new BlockDocumentError('INVALID_BLOCK_HTML');
    try {
      return this.#codec.export(imported.document).html;
    } catch {
      throw new BlockDocumentError('INVALID_BLOCK_HTML');
    }
  }

  acceptsHtml(value: string, kind: DocumentKind): boolean {
    if (value.length > HTML_LIMITS[kind]) return false;
    return this.cached(`h\u0000${kind}`, value, () => {
      try {
        if (this.normalizeHtml(value) !== value) return false;
      } catch {
        return false;
      }
      // MJML ends a raw region at its closing tag wherever it appears, even in an attribute.
      if (kind === 'email' && /<\/?mj-/i.test(value)) return false;
      // The canvas marks are the editor's: an author's copy would leak to the output and
      // could pose as another block in the preview.
      if (/data-visual-editor-/i.test(value)) return false;
      const document = this.inspected(value, kind);
      if (
        !document ||
        document.nodes.some(
          (node) => node.type === 'doctype' || ['html', 'head', 'body'].includes(node.tag ?? ''),
        )
      )
        return false;
      return this.authorElements(value, kind) && (kind === 'page' || this.emailResources(document));
    });
  }

  /**
   * Every element as a browser without scripting reads it (inside SVG, `noscript` and
   * `template` too): no generated class, no element which swallows the rest of the output
   * and, in an e-mail, nothing that redirects it or renders markup as text.
   */
  private authorElements(value: string, kind: DocumentKind): boolean {
    const forbidden = kind === 'email' ? EMAIL_FORBIDDEN_TAGS : PAGE_FORBIDDEN_TAGS;
    const stack: DefaultTreeAdapterMap['parentNode'][] = [
      parseFragment(value, { scriptingEnabled: false }),
    ];
    while (stack.length) {
      const parent = stack.pop();
      if (!parent) break;
      for (const child of parent.childNodes) {
        if ('data' in child && writesGeneratedClass(child.data)) return false;
        if (!('tagName' in child)) continue;
        if (forbidden.has(child.tagName)) return false;
        for (const attribute of child.attrs)
          if (
            isReservedAttribute(attribute.name) ||
            (attribute.name === 'class' &&
              attribute.value.split(/\s+/).some((token) => token.toLowerCase().startsWith('ve-')))
          )
            return false;
        stack.push('content' in child ? child.content : child);
      }
    }
    return true;
  }

  /**
   * The only external style resources an e-mail may load are Google Fonts: style sheets from
   * `fonts.googleapis.com` and font files from `fonts.gstatic.com`.
   */
  private emailResources(document: EditorDocumentData): boolean {
    const inventory = this.#policy.inspect(document);
    if (inventory.metaRefresh || inventory.baseUrls.length) return false;
    if (!inventory.stylesheets.every((entry) => entry.url.startsWith(GOOGLE_FONTS_CSS)))
      return false;
    if (
      !inventory.links.every(
        (entry) =>
          entry.url.startsWith(GOOGLE_FONTS_CSS) || entry.url.startsWith(GOOGLE_FONTS_FILES),
      )
    )
      return false;
    const stack: DocumentNode[] = [...document.nodes];
    while (stack.length) {
      const node = stack.pop();
      if (!node) break;
      if (node.type === 'element' && node.tag === 'style') {
        const css = this.#css.inspect(
          (node.children ?? []).map((child) => child.value ?? '').join(''),
        );
        if (
          ![...css.urls, ...css.urlCandidates].every(
            (url) => url.startsWith(GOOGLE_FONTS_CSS) || url.startsWith(GOOGLE_FONTS_FILES),
          )
        )
          return false;
      }
      stack.push(...(node.children ?? []));
    }
    return true;
  }

  /** The document a fragment imports as, when the codec reads it with nothing but `info`. */
  private inspected(value: string, kind: DocumentKind): EditorDocumentData | undefined {
    const imported = this.#codec.inspect({ html: value, css: '' }, kind);
    if (!imported.document) return undefined;
    if (imported.diagnostics.some((item) => item.severity !== 'info')) return undefined;
    return imported.document;
  }

  private projectionNodes(nodes: readonly DocumentNode[], mode: RichTextMode): boolean {
    return (
      this.#markup.violation(nodes, mode, {
        style: (value) => !!this.#css.richTextStyles(value),
      }) === undefined
    );
  }

  /**
   * One line: paragraphs become line breaks and, for a button, links become their text. The
   * result is projected again, so it is a fixed point.
   */
  private flatten(html: string, dropLinks: boolean): string {
    const fragment = parseFragment(html);
    if (dropLinks) this.unwrapLinks(fragment);
    const lines: DefaultTreeAdapterMap['childNode'][][] = [];
    let current: DefaultTreeAdapterMap['childNode'][] = [];
    for (const node of fragment.childNodes) {
      if ('tagName' in node && node.tagName === 'p') {
        if (current.length) lines.push(current);
        lines.push([...node.childNodes]);
        current = [];
      } else current.push(node);
    }
    if (current.length) lines.push(current);
    const render = (nodes: readonly DefaultTreeAdapterMap['childNode'][]): string => {
      const holder = parseFragment('');
      holder.childNodes.push(...nodes);
      return serialize(holder);
    };
    const flat = lines
      .map(render)
      .filter((line) => line !== '')
      .join('<br>');
    return this.#projection.project(flat, false).html;
  }

  private unwrapLinks(parent: DefaultTreeAdapterMap['parentNode']): void {
    const children: DefaultTreeAdapterMap['childNode'][] = [];
    for (const child of parent.childNodes) {
      if (!('tagName' in child)) {
        children.push(child);
        continue;
      }
      this.unwrapLinks(child);
      if (child.tagName === 'a') children.push(...child.childNodes);
      else children.push(child);
    }
    parent.childNodes = children;
  }

  /**
   * Results by kind, mode and SHA-256 of the value: the cache keeps 2.000 short keys, never
   * the texts themselves (an HTML block may have hundreds of kilobytes).
   */
  private cached(scope: string, value: string, compute: () => boolean): boolean {
    const key = `${scope}\u0000${sha256Base64(value)}`;
    const known = this.#cache.get(key);
    if (known !== undefined) {
      this.#cache.delete(key);
      this.#cache.set(key, known);
      return known;
    }
    const result = compute();
    this.#cache.set(key, result);
    if (this.#cache.size > CACHE_SIZE) {
      const oldest = this.#cache.keys().next().value;
      if (oldest !== undefined) this.#cache.delete(oldest);
    }
    return result;
  }

  /** Entries currently held and the characters of their keys, for the bound on memory. */
  cacheFootprint(): { readonly entries: number; readonly keyCharacters: number } {
    let keyCharacters = 0;
    for (const key of this.#cache.keys()) keyCharacters += key.length;
    return { entries: this.#cache.size, keyCharacters };
  }
}
