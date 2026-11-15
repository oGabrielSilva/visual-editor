import type { DefaultTreeAdapterMap } from 'parse5';
import { DocumentBudget } from '../core/budget';
import { DocumentValidationError } from '../core/document';
import { BoundedHtmlParser } from './bounded-parser';
import { escapeHtml } from '../core/html-escape';
import { UrlPolicy } from './url-policy';
import { CssDocumentCodec } from '../codecs/css';
import {
  RichTextFormatPolicy,
  RICH_TEXT_ORIGIN_ATTRIBUTE,
  RICH_TEXT_REMOVED_ATTRIBUTE,
} from '../core/rich-text-format';

export interface RichTextProjectionResult {
  readonly html: string;
  readonly adjusted: boolean;
}

/**
 * The ceilings of one editable text are lower than those of a whole document: a text region is
 * never a whole imported page.
 */
const RICH_TEXT_LIMITS = Object.freeze({ nodes: 10_000, depth: 80 });

/** An inert parse5 projection is the only markup accepted by the authenticated rich-text DOM. */
export class RichTextProjection {
  private readonly budget = new DocumentBudget();
  private readonly formats = new RichTextFormatPolicy();
  private readonly inline = new Set([
    'span',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'a',
    'br',
    'sup',
    'sub',
    'code',
  ]);
  private readonly blocks = new Set([
    'p',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'pre',
    'hr',
  ]);
  private readonly discarded = new Set([
    'script',
    'style',
    'template',
    'iframe',
    'object',
    'embed',
    'noscript',
    'xmp',
    'plaintext',
    'noembed',
    'noframes',
    'textarea',
    'title',
  ]);

  /** A text nests far less than a document; the parse ends as soon as it goes beyond that. */
  private readonly parser = new BoundedHtmlParser(RICH_TEXT_LIMITS.depth);
  private readonly styles: CssDocumentCodec;
  constructor(private readonly urls = new UrlPolicy()) {
    this.styles = new CssDocumentCodec(urls);
  }

  project(source: string, allowBlocks = false): RichTextProjectionResult {
    this.budget.assertSource(source, '');
    let fragment: DefaultTreeAdapterMap['documentFragment'];
    try {
      fragment = this.parser.fragment(source, { scriptingEnabled: false });
    } catch (error: unknown) {
      if (error instanceof DocumentValidationError)
        throw new RangeError('RICH_TEXT_TOO_COMPLEX', { cause: error });
      throw error;
    }
    let count = 0;
    let adjusted = false;
    const render = (node: DefaultTreeAdapterMap['childNode'], depth: number): string => {
      if (++count > RICH_TEXT_LIMITS.nodes || depth > RICH_TEXT_LIMITS.depth)
        throw new RangeError('RICH_TEXT_TOO_COMPLEX');
      if (node.nodeName === '#text' && 'value' in node) return escapeHtml(node.value);
      if (!('tagName' in node)) return '';
      const tag = node.tagName;
      if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || this.discarded.has(tag)) {
        adjusted = true;
        return '';
      }
      const children = (): string =>
        node.childNodes.map((child) => render(child, depth + 1)).join('');
      if (!this.inline.has(tag) && !(this.blocks.has(tag) && (allowBlocks || tag === 'p'))) {
        adjusted = true;
        return children();
      }
      const attrs: [string, string][] = [];
      for (const attribute of node.attrs) {
        const name = attribute.name;
        const value = attribute.value;
        if (attribute.namespace || attribute.prefix) {
          adjusted = true;
          continue;
        }
        if (
          name === RICH_TEXT_REMOVED_ATTRIBUTE &&
          tag === 'span' &&
          this.formats.isFormat(value) &&
          node.attrs.some(
            (attribute) =>
              attribute.name === RICH_TEXT_ORIGIN_ATTRIBUTE &&
              attribute.value.length > 0 &&
              attribute.value.length <= 200,
          )
        )
          attrs.push([name, value]);
        else if (name === RICH_TEXT_ORIGIN_ATTRIBUTE && value.length > 0 && value.length <= 200)
          attrs.push([name, value]);
        else if (
          tag === 'a' &&
          name === 'href' &&
          value.length <= DocumentBudget.limits.attributeLength &&
          this.urls.isSafe(value, 'link')
        )
          attrs.push([name, value]);
        else if (tag === 'a' && name === 'target' && ['_blank', '_self'].includes(value))
          attrs.push([name, value]);
        else if (
          tag === 'a' &&
          ['rel', 'title'].includes(name) &&
          value.length <= DocumentBudget.limits.attributeLength
        )
          attrs.push([name, value]);
        else if (name === 'style') {
          const styles = this.styles.richTextStyles(value);
          if (styles)
            attrs.push([
              name,
              Object.entries(styles)
                .map(([property, css]) => `${property}:${css}`)
                .join(';'),
            ]);
          else adjusted = true;
        } else if (tag === 'ol' && name === 'start' && /^-?\d{1,8}$/.test(value))
          attrs.push([name, value]);
        else adjusted = true;
      }
      if (tag === 'a' && !attrs.some(([name]) => name === 'href')) {
        adjusted = true;
        return children();
      }
      const textStyle = attrs.find(([name]) => name === 'style');
      let content = children();
      if (textStyle && tag !== 'span') {
        attrs.splice(attrs.indexOf(textStyle), 1);
        if (this.inline.has(tag) || ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre'].includes(tag))
          content = `<span style="${escapeHtml(textStyle[1])}">${content}</span>`;
        else adjusted = true;
      }
      const serialized = attrs.map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join('');
      return tag === 'br' || tag === 'hr'
        ? `<${tag}${serialized}>`
        : `<${tag}${serialized}>${content}</${tag}>`;
    };
    const html = fragment.childNodes.map((node) => render(node, 0)).join('');
    return { html, adjusted };
  }
}
