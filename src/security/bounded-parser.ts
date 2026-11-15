import { defaultTreeAdapter, parse, parseFragment } from 'parse5';
import type { DefaultTreeAdapterMap, ParserOptions } from 'parse5';
import { DocumentBudget } from '../core/budget';
import { DocumentValidationError } from '../core/document';

type ParentNode = DefaultTreeAdapterMap['parentNode'];
type Options = Omit<ParserOptions<DefaultTreeAdapterMap>, 'treeAdapter'>;

/**
 * Ancestors the parser adds above what the document model counts from zero: the document, `html`
 * and `body` when flow content is read out of a document parse.
 */
const PARSER_ANCESTORS = 3;

/**
 * Parses untrusted markup with a ceiling on nesting which is enforced while the tree is built.
 * The parser scans its stack of open elements on most tags, so a source of tens of thousands of
 * nested elements costs time quadratic in its depth before any limit of the document model could
 * see it. Here the parse ends at the first element placed deeper than the limit, with the same
 * diagnostic the model gives. A tree within the limit is exactly the tree of the plain parser.
 */
export class BoundedHtmlParser {
  readonly #limit: number;
  readonly #owners = new WeakMap<object, ParentNode>();
  readonly #adapter: typeof defaultTreeAdapter;

  constructor(depth: number = DocumentBudget.limits.depth) {
    if (!Number.isInteger(depth) || depth < 1) throw new RangeError('INVALID_NESTING_LIMIT');
    this.#limit = depth + PARSER_ANCESTORS;
    this.#adapter = {
      ...defaultTreeAdapter,
      appendChild: (parent, node) => {
        this.guard(parent);
        defaultTreeAdapter.appendChild(parent, node);
      },
      insertBefore: (parent, node, reference) => {
        this.guard(parent);
        defaultTreeAdapter.insertBefore(parent, node, reference);
      },
      setTemplateContent: (template, content) => {
        this.#owners.set(content, template);
        defaultTreeAdapter.setTemplateContent(template, content);
      },
    };
  }

  document(markup: string, options: Options = {}): DefaultTreeAdapterMap['document'] {
    return parse(markup, { ...options, treeAdapter: this.#adapter });
  }

  /** `context` is the element whose content the markup is, e.g. an `svg` root for an island. */
  fragment(
    markup: string,
    options: Options = {},
    context?: DefaultTreeAdapterMap['element'],
  ): DefaultTreeAdapterMap['documentFragment'] {
    const bounded = { ...options, treeAdapter: this.#adapter };
    return context ? parseFragment(context, markup, bounded) : parseFragment(markup, bounded);
  }

  private guard(parent: ParentNode): void {
    let depth = 0;
    let node: ParentNode | undefined | null = parent;
    while (node) {
      if (++depth > this.#limit) throw new DocumentValidationError('DOCUMENT_TOO_DEEP');
      node = ('parentNode' in node ? node.parentNode : undefined) ?? this.#owners.get(node);
    }
  }
}
