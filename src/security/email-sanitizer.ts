import type { DocumentNode } from '../core/document';
import { ActiveMarkupRules } from './markup-rules';
import type { ActiveMarkup } from './markup-rules';
import { isConditionalComment, SOURCE_CONTEXTS, SourceMarkup } from './source-markup';
import type { ActiveStyleRemover, SourceContext } from './source-markup';

/** What was taken out of an e-mail, or rewritten in it. */
export type EmailRemoval = ActiveMarkup | 'charset';

export interface SanitizedEmail {
  readonly nodes: readonly DocumentNode[];
  /** One entry per occurrence; empty when the tree is returned untouched. */
  readonly removed: readonly EmailRemoval[];
}

const UTF8_CONTENT_TYPE = 'text/html; charset=utf-8';

/**
 * An e-mail never carries scripts, embedded documents, inline handlers, code URLs, CSS which
 * would run code, a refresh or a `base`: no client runs them and several
 * reject the whole message. They are removed,
 * never refused. Elements leave with their content; an attribute leaves and its element stays;
 * a declaration leaves and the rest of its style stays. Everything else, conditional comments
 * and VML included, is kept as written.
 */
export class EmailSanitizer {
  readonly #rules: ActiveMarkupRules;
  readonly #sources: SourceMarkup;
  readonly #styles: ActiveStyleRemover | undefined;

  constructor(
    rules = new ActiveMarkupRules(),
    styles?: ActiveStyleRemover,
    sources = new SourceMarkup(rules, styles),
  ) {
    this.#rules = rules;
    this.#styles = styles;
    this.#sources = sources;
  }

  /** The panel CSS of the document, under the same rule as its style elements. */
  stylesheet(css: string): { readonly css: string; readonly removed: readonly EmailRemoval[] } {
    const stripped = this.#styles?.stripActive(css);
    return stripped?.removed
      ? { css: stripped.css, removed: Array<EmailRemoval>(stripped.removed).fill('style') }
      : { css, removed: [] };
  }

  sanitize(nodes: readonly DocumentNode[]): SanitizedEmail {
    const removed: EmailRemoval[] = [];
    const cleaned = this.nodes(nodes, removed);
    return removed.length ? { nodes: cleaned, removed } : { nodes, removed };
  }

  private nodes(nodes: readonly DocumentNode[], removed: EmailRemoval[]): readonly DocumentNode[] {
    const output: DocumentNode[] = [];
    for (const node of nodes) {
      const cleaned = this.node(node, removed);
      if (cleaned) output.push(cleaned);
    }
    return output;
  }

  private node(node: DocumentNode, removed: EmailRemoval[]): DocumentNode | undefined {
    if (node.type === 'comment') {
      const value = node.value ?? '';
      if (!isConditionalComment(value)) return node;
      const stripped = this.source(value, 'html', removed);
      if (stripped === undefined) return undefined;
      return stripped === value ? node : { ...node, value: stripped };
    }
    if (node.type !== 'element') return node;
    const tag = (node.tag ?? '').toLowerCase();
    const active =
      this.#rules.element(tag) ??
      this.#rules.elementWith(tag, node.attrs ?? {}) ??
      this.#rules.navigation(tag, node.attrs ?? {});
    if (active) {
      removed.push(active);
      return undefined;
    }
    let attrs = node.attrs;
    for (const [name, value] of Object.entries(node.attrs ?? {})) {
      const finding = this.#rules.attribute(name, value);
      if (finding) {
        removed.push(finding);
        attrs = Object.fromEntries(Object.entries(attrs ?? {}).filter(([key]) => key !== name));
        continue;
      }
      if (name.toLowerCase() !== 'style') continue;
      const stripped = this.#styles?.stripActive(value, 'declarationList');
      if (!stripped?.removed) continue;
      removed.push(...Array<EmailRemoval>(stripped.removed).fill('style'));
      attrs = Object.fromEntries(
        Object.entries(attrs ?? {}).flatMap(([key, current]) =>
          key !== name ? [[key, current]] : stripped.css.trim() ? [[key, stripped.css]] : [],
        ),
      );
    }
    if (tag === 'meta') attrs = this.charset(attrs, removed);
    const context = SOURCE_CONTEXTS[tag];
    let children = node.children;
    if (context) {
      const text = (children ?? []).map((child) => child.value ?? '').join('');
      const stripped = this.source(text, context, removed);
      if (stripped === undefined) return undefined;
      if (stripped !== text)
        children = stripped
          ? [{ id: children?.[0]?.id ?? `${node.id}-source`, type: 'text', value: stripped }]
          : [];
    } else if (tag === 'style') {
      const text = (children ?? []).map((child) => child.value ?? '').join('');
      const stripped = this.#styles?.stripActive(text);
      if (stripped?.removed) {
        removed.push(...Array<EmailRemoval>(stripped.removed).fill('style'));
        children = stripped.css
          ? [{ id: children?.[0]?.id ?? `${node.id}-source`, type: 'text', value: stripped.css }]
          : [];
      }
    } else if (children) {
      const cleaned = this.nodes(children, removed);
      if (cleaned.length !== children.length || cleaned.some((child, i) => child !== children?.[i]))
        children = cleaned;
    }
    if (attrs === node.attrs && children === node.children) return node;
    return {
      ...node,
      ...(attrs ? { attrs } : {}),
      ...(children ? { children } : {}),
    };
  }

  /** Undefined when the block could not be made clean and is dropped as a whole. */
  private source(
    text: string,
    context: SourceContext,
    removed: EmailRemoval[],
  ): string | undefined {
    const stripped = this.#sources.strip(text, context);
    if (!stripped) {
      removed.push('embed');
      return undefined;
    }
    removed.push(...stripped.removed);
    return stripped.source;
  }

  /** The source reaches the editor as decoded text; whatever it declared, it is UTF-8 now. */
  private charset(
    attrs: Readonly<Record<string, string>> | undefined,
    removed: EmailRemoval[],
  ): Readonly<Record<string, string>> | undefined {
    if (!attrs) return attrs;
    const next: Record<string, string> = { ...attrs };
    let changed = false;
    for (const [name, value] of Object.entries(attrs)) {
      const key = name.toLowerCase();
      if (key === 'charset' && value.trim().toLowerCase() !== 'utf-8') {
        next[name] = 'utf-8';
        changed = true;
      }
      if (key !== 'content') continue;
      const directive = Object.entries(attrs).find(
        ([candidate]) => candidate.toLowerCase() === 'http-equiv',
      )?.[1];
      if (directive?.trim().toLowerCase() !== 'content-type') continue;
      const charset = value
        .split(';')
        .map((part) => part.split('='))
        .find(([parameter]) => parameter?.trim().toLowerCase() === 'charset')?.[1];
      if (charset !== undefined && charset.trim().toLowerCase() !== 'utf-8') {
        next[name] = UTF8_CONTENT_TYPE;
        changed = true;
      }
    }
    if (!changed) return attrs;
    removed.push('charset');
    return next;
  }
}
