import {
  NODE_ATTRIBUTE as NODE_KEY,
  SELECTED_ATTRIBUTE as SELECTED,
} from '../core/canvas-contract';

/**
 * Never brought into the running window, whatever the host sent: a script, what acts on the
 * window itself (`meta`, of which a refresh would navigate it away; `base`) and HTML imports.
 */
const NEVER_INSERTED = 'script,meta,base,link[rel~="import" i]';

/** The external resources of the head: when they change the window is written again. */
function headResources(head: ParentNode): string {
  return [...head.querySelectorAll('link:not([rel~="import" i])')]
    .map((link) =>
      [...link.attributes]
        .map((attribute) => `${attribute.name}=${attribute.value}`)
        .sort()
        .join('\n'),
    )
    .join('\n\n');
}

export interface MorphOptions {
  /** Nodes owned by the runtime: never matched, moved or removed. */
  readonly keep: (node: Node) => boolean;
  /** The element under edition is left exactly as it is, attributes and content. */
  readonly frozen?: (element: Element) => boolean;
}

/**
 * Reconciles the live preview with the next validated revision without reloading the window.
 * The incoming markup is parsed into an inert document and is subject to the same CSP. It throws
 * when the revision needs a new window; the caller then asks the host for one.
 */
export class DocumentMorph {
  constructor(private readonly options: MorphOptions) {}

  apply(html: string): void {
    // This parser has no scripting: unlike the window, it reads `noscript` as markup.
    const next = new DOMParser().parseFromString(html, 'text/html');
    for (const holder of next.querySelectorAll('noscript')) holder.replaceChildren();
    for (const active of next.body.querySelectorAll(NEVER_INSERTED)) active.remove();
    for (const active of next.head.querySelectorAll('script,base,meta[http-equiv]'))
      active.remove();
    // A style sheet or font added or replaced in the head only loads in a new window.
    if (headResources(next.head) !== headResources(document.head))
      throw new Error('HEAD_RESOURCES_CHANGED');
    const keyed = new Map<string, Element>();
    for (const element of document.body.querySelectorAll(`[${NODE_KEY}]`)) {
      const key = element.getAttribute(NODE_KEY);
      if (key && !keyed.has(key)) keyed.set(key, element);
    }
    this.attributes(document.documentElement, next.documentElement);
    this.head(next);
    this.attributes(document.body, next.body);
    this.children(document.body, next.body, keyed);
  }

  private head(next: Document): void {
    if (next.title && document.title !== next.title) document.title = next.title;
    const live = [...document.head.querySelectorAll('style')];
    const incoming = [...next.head.querySelectorAll('style')];
    incoming.forEach((style, index) => {
      const current = live[index];
      if (!current) document.head.append(document.importNode(style, true));
      else if (current.textContent !== style.textContent) current.textContent = style.textContent;
    });
    for (const stale of live.slice(incoming.length)) stale.remove();
  }

  private attributes(live: Element, next: Element): void {
    for (const attribute of [...live.attributes]) {
      if (attribute.name === SELECTED || next.hasAttribute(attribute.name)) continue;
      live.removeAttribute(attribute.name);
    }
    for (const attribute of [...next.attributes])
      if (live.getAttribute(attribute.name) !== attribute.value)
        live.setAttribute(attribute.name, attribute.value);
  }

  private matches(live: Node, next: Node): boolean {
    if (live.nodeType !== next.nodeType) return false;
    if (live.nodeType !== Node.ELEMENT_NODE) return true;
    const current = live as Element;
    const incoming = next as Element;
    return (
      current.localName === incoming.localName &&
      current.namespaceURI === incoming.namespaceURI &&
      current.getAttribute(NODE_KEY) === incoming.getAttribute(NODE_KEY)
    );
  }

  private children(live: Node, next: Node, keyed: Map<string, Element>): void {
    let cursor: ChildNode | null = live.firstChild;
    const skip = (): void => {
      while (cursor && this.options.keep(cursor)) cursor = cursor.nextSibling;
    };
    for (const incoming of [...next.childNodes]) {
      skip();
      const key =
        incoming.nodeType === Node.ELEMENT_NODE
          ? (incoming as Element).getAttribute(NODE_KEY)
          : null;
      let match: Node | undefined;
      if (cursor && this.matches(cursor, incoming)) match = cursor;
      else if (key) {
        const candidate = keyed.get(key);
        // A block which changed parent travels with its subtree instead of being rebuilt.
        if (candidate && this.matches(candidate, incoming) && !candidate.contains(live))
          match = candidate;
      } else {
        // Unkeyed content pairs by position and tag among the following siblings.
        let ahead: ChildNode | null = cursor?.nextSibling ?? null;
        for (let distance = 0; ahead && distance < 8; distance += 1, ahead = ahead.nextSibling) {
          if (this.options.keep(ahead)) continue;
          if (
            ahead.nodeType === Node.ELEMENT_NODE &&
            !(ahead as Element).hasAttribute(NODE_KEY) &&
            this.matches(ahead, incoming)
          ) {
            match = ahead;
            break;
          }
        }
      }
      if (!match) {
        live.insertBefore(document.importNode(incoming, true), cursor);
        continue;
      }
      if (key) keyed.delete(key);
      if (match !== cursor) live.insertBefore(match, cursor);
      else cursor = cursor.nextSibling;
      this.node(match, incoming, keyed);
    }
    skip();
    while (cursor) {
      const stale: ChildNode = cursor;
      cursor = cursor.nextSibling;
      if (!this.options.keep(stale)) stale.remove();
    }
  }

  private node(live: Node, next: Node, keyed: Map<string, Element>): void {
    if (live.nodeType !== Node.ELEMENT_NODE) {
      if (live.nodeValue !== next.nodeValue) live.nodeValue = next.nodeValue;
      return;
    }
    const element = live as Element;
    if (this.options.frozen?.(element)) return;
    this.attributes(element, next as Element);
    // Inert text in this window, markup to the parser of the revision: it stays as it loaded.
    if (element.localName === 'noscript') return;
    this.children(element, next, keyed);
  }
}
