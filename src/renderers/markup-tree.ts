import { defaultTreeAdapter, html } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { isInfrastructureTag, isReservedAttribute } from '../core/canvas-contract';
import type { DocumentNode } from '../core/document';

export type MarkupElement = DefaultTreeAdapterMap['element'];
export type MarkupParent = DefaultTreeAdapterMap['parentNode'];

export interface DocumentParts {
  readonly root?: MarkupElement;
  readonly head?: MarkupElement;
  /** Absent in a page made of frames, which has a `frameset` where the body would be. */
  readonly body?: MarkupElement;
  readonly frameset?: MarkupElement;
}

const child = (parent: MarkupParent | undefined, tag: string): MarkupElement | undefined =>
  parent?.childNodes.find(
    (node): node is MarkupElement => defaultTreeAdapter.isElementNode(node) && node.tagName === tag,
  );

/** The elements every parsed document has, wherever the source wrote or implied them. */
export function documentParts(document: DefaultTreeAdapterMap['document']): DocumentParts {
  const root = child(document, 'html');
  const head = child(root, 'head');
  const body = child(root, 'body');
  const frameset = child(root, 'frameset');
  return {
    ...(root ? { root } : {}),
    ...(head ? { head } : {}),
    ...(body ? { body } : {}),
    ...(frameset ? { frameset } : {}),
  };
}

/** The children a walk follows: the content of a template stands where its children would. */
export function markupChildren(node: MarkupParent): readonly DefaultTreeAdapterMap['childNode'][] {
  return 'content' in node ? node.content.childNodes : node.childNodes;
}

/** Removes every attribute reserved to the editor below `root`, template contents included. */
export function stripReservedAttributes(root: MarkupParent): void {
  const stack: MarkupParent[] = [root];
  while (stack.length) {
    const parent = stack.pop();
    if (!parent) break;
    if (
      defaultTreeAdapter.isElementNode(parent) &&
      parent.attrs.some((a) => isReservedAttribute(a.name))
    )
      parent.attrs = parent.attrs.filter((attribute) => !isReservedAttribute(attribute.name));
    for (const node of markupChildren(parent))
      if (defaultTreeAdapter.isElementNode(node)) stack.push(node);
  }
}

/** Elements of the document which a parser shows as elements of the piece, in document order. */
export function canonicalElements(nodes: readonly DocumentNode[]): DocumentNode[] {
  const canonical: DocumentNode[] = [];
  const stack = [...nodes].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (!node) break;
    if (node.type === 'element' && !isInfrastructureTag(node.tag ?? '')) canonical.push(node);
    const children = node.children ?? [];
    for (let index = children.length - 1; index >= 0; index--) {
      const entry = children[index];
      if (entry) stack.push(entry);
    }
  }
  return canonical;
}

export interface AlignmentVisitor {
  /** Every element of the HTML tree, infrastructure included, before it is matched. */
  element?(element: MarkupElement): void;
  /**
   * An element of the markup and the node of the document it stands for. `island` is an inline
   * SVG or MathML: one node of the document, whose inside is never walked. Return `false` to end
   * the walk there.
   */
  match(element: MarkupElement, node: DocumentNode, island: boolean): boolean | void;
}

/**
 * The one rule which pairs the markup a parser reads with the nodes of the document: the same
 * elements in the same order, skipping what every document has (`html`, `head`, `body`, `style`,
 * `meta`, `title`) and never going inside foreign content, which the document keeps as source.
 * Returns how many nodes were paired, or undefined when markup and document disagree.
 */
export function alignElements(
  root: MarkupParent,
  canonical: readonly DocumentNode[],
  visitor: AlignmentVisitor,
): number | undefined {
  let index = 0;
  const stack: DefaultTreeAdapterMap['childNode'][] = [...root.childNodes].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (!node) break;
    if (!defaultTreeAdapter.isElementNode(node)) continue;
    visitor.element?.(node);
    let island = false;
    if (!isInfrastructureTag(node.tagName)) {
      const expected = canonical[index];
      if (!expected || expected.tag?.toLowerCase() !== node.tagName) return undefined;
      index += 1;
      island = node.namespaceURI !== html.NS.HTML;
      if (visitor.match(node, expected, island) === false) return index;
    }
    if (island) continue;
    for (let position = node.childNodes.length - 1; position >= 0; position--) {
      const entry = node.childNodes[position];
      if (entry) stack.push(entry);
    }
  }
  return index;
}
