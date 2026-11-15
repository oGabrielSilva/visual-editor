import { defaultTreeAdapter, html } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { DocumentBudget } from '../core/budget';
import { BoundedHtmlParser } from './bounded-parser';
import { ActiveMarkupRules } from './markup-rules';
import type { ActiveMarkup } from './markup-rules';

/** Where a block of source kept as text would be parsed by whoever renders it. */
export type SourceContext = 'html' | 'svg' | 'math';

/** The elements whose content the document keeps as source, and how that source is read. */
export const SOURCE_CONTEXTS: Readonly<Record<string, SourceContext>> = Object.freeze({
  noscript: 'html',
  noembed: 'html',
  noframes: 'html',
  template: 'html',
  svg: 'svg',
  math: 'math',
});

/** A conditional comment hides markup which Outlook, or an old browser, does render. */
export function isConditionalComment(value: string): boolean {
  return value.trimStart().toLowerCase().startsWith('[if');
}

/** Active CSS is removed from a style attribute or sheet; absent, styles are left as written. */
export interface ActiveStyleRemover {
  stripActive(
    css: string,
    context?: 'stylesheet' | 'declarationList',
  ): { readonly css: string; readonly removed: number };
}

export interface SourceElement {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  /** Text directly inside the element, e.g. the code of an inline script. */
  readonly text: string;
}

export interface StrippedSource {
  readonly source: string;
  readonly removed: readonly ActiveMarkup[];
}

interface Cut {
  readonly start: number;
  readonly end: number;
  readonly kind: ActiveMarkup;
}

type Element = DefaultTreeAdapterMap['element'];

const RAW_TEXT: ReadonlySet<string> = new Set(['script', 'iframe']);
const ROUNDS = 4;

/**
 * Reads markup the document keeps as text: conditional comments, `noscript`, `template` and
 * inline SVG or MathML. It is parsed only to be inspected; what is not removed stays byte for
 * byte, because these blocks are often unbalanced fragments no serializer would reproduce.
 */
export class SourceMarkup {
  /** A block nests no deeper than a document may: beyond that the parse ends with its error. */
  readonly #parser = new BoundedHtmlParser();

  constructor(
    private readonly rules = new ActiveMarkupRules(),
    private readonly styles?: ActiveStyleRemover,
  ) {}

  /**
   * Every element in the block, nested templates included. Empty when it has too many nodes;
   * throws `DOCUMENT_TOO_DEEP` when it nests beyond the limit of a document.
   */
  elements(source: string, context: SourceContext = 'html'): readonly SourceElement[] {
    return (
      this.walk(source, context, false)?.map((element) => ({
        tag: element.tagName,
        attrs: Object.fromEntries(
          element.attrs.map((attribute) => [this.name(attribute), attribute.value]),
        ),
        text: element.childNodes
          .map((child) => (defaultTreeAdapter.isTextNode(child) ? child.value : ''))
          .join(''),
      })) ?? []
    );
  }

  /**
   * Cuts scripts, embeds, inline handlers and code URLs out of the text by their source
   * positions and checks the result again. Undefined when it could not be made clean: the
   * caller then drops the whole block rather than keep something it cannot vouch for.
   */
  strip(source: string, context: SourceContext = 'html'): StrippedSource | undefined {
    let current = source;
    const removed: ActiveMarkup[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const cuts = this.cuts(current, context);
      if (!cuts) return undefined;
      if (!cuts.length) return { source: current, removed };
      const merged: Cut[] = [];
      for (const cut of [...cuts].sort((left, right) => left.start - right.start)) {
        const last = merged.at(-1);
        if (last && cut.start < last.end)
          merged[merged.length - 1] = { ...last, end: Math.max(last.end, cut.end) };
        else merged.push(cut);
      }
      let output = '';
      let cursor = 0;
      for (const cut of merged) {
        output += current.slice(cursor, cut.start);
        cursor = cut.end;
        removed.push(cut.kind);
      }
      current = output + current.slice(cursor);
    }
    return undefined;
  }

  private cuts(source: string, context: SourceContext): readonly Cut[] | undefined {
    const elements = this.walk(source, context, true);
    if (!elements) return undefined;
    const cuts: Cut[] = [];
    for (const element of elements) {
      const location = element.sourceCodeLocation;
      const kind =
        this.rules.element(element.tagName) ??
        this.rules.elementWith(element.tagName, this.attributes(element)) ??
        this.rules.navigation(element.tagName, this.attributes(element)) ??
        this.activeSheet(element);
      if (kind) {
        // Without positions the element cannot be cut: the block is not kept at all.
        if (!location) return undefined;
        const whole =
          location.endTag ||
          (element.namespaceURI === html.NS.HTML && RAW_TEXT.has(element.tagName));
        cuts.push({
          kind,
          start: location.startOffset,
          end: whole ? location.endOffset : (location.startTag?.endOffset ?? location.endOffset),
        });
        continue;
      }
      for (const attribute of element.attrs) {
        const name = this.name(attribute);
        const finding =
          this.rules.attribute(name, attribute.value) ??
          (name.toLowerCase() === 'style' &&
          this.styles?.stripActive(attribute.value, 'declarationList').removed
            ? ('style' as const)
            : undefined);
        if (!finding) continue;
        const position = Object.entries(location?.attrs ?? {}).find(
          ([key]) => key.toLowerCase() === name.toLowerCase(),
        )?.[1];
        if (!position) return undefined;
        cuts.push({ kind: finding, start: position.startOffset, end: position.endOffset });
      }
    }
    return cuts;
  }

  /** A style sheet inside the block which holds active CSS leaves whole. */
  private activeSheet(element: Element): 'style' | undefined {
    if (element.tagName !== 'style' || !this.styles) return undefined;
    const sheet = element.childNodes
      .map((child) => (defaultTreeAdapter.isTextNode(child) ? child.value : ''))
      .join('');
    return this.styles.stripActive(sheet).removed ? 'style' : undefined;
  }

  private walk(
    source: string,
    context: SourceContext,
    locations: boolean,
  ): readonly Element[] | undefined {
    const options = { sourceCodeLocationInfo: locations, scriptingEnabled: false };
    const fragment =
      context === 'html'
        ? this.#parser.fragment(source, options)
        : this.#parser.fragment(
            source,
            options,
            defaultTreeAdapter.createElement(
              context,
              context === 'svg' ? html.NS.SVG : html.NS.MATHML,
              [],
            ),
          );
    const elements: Element[] = [];
    const stack = [...fragment.childNodes].reverse();
    let count = 0;
    while (stack.length) {
      const node = stack.pop();
      if (!node) break;
      if (++count > DocumentBudget.limits.totalNodes) return undefined;
      if (!defaultTreeAdapter.isElementNode(node)) continue;
      elements.push(node);
      const children = 'content' in node ? node.content.childNodes : node.childNodes;
      for (let index = children.length - 1; index >= 0; index--) {
        const child = children[index];
        if (child) stack.push(child);
      }
    }
    return elements;
  }

  private attributes(element: {
    readonly attrs: readonly {
      readonly name: string;
      readonly prefix?: string;
      readonly value: string;
    }[];
  }): Readonly<Record<string, string>> {
    return Object.fromEntries(element.attrs.map((entry) => [this.name(entry), entry.value]));
  }

  private name(attribute: { readonly name: string; readonly prefix?: string }): string {
    return attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name;
  }
}
