import { parse, serialize } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import type { Block, BlockDocument, BlockNodeType } from '../core/block-document';
import { EDIT_NODE_ATTRIBUTE, NODE_ATTRIBUTE } from '../core/canvas-contract';

type Element = DefaultTreeAdapterMap['element'];

/** Element, under the marked cell, whose text the author edits in place. */
const EDITABLE: Partial<Record<BlockNodeType, readonly string[]>> = {
  text: ['div'],
  footer: ['div'],
  heading: ['h1', 'h2', 'h3'],
  button: ['a', 'p'],
};

/**
 * Turns the preview classes `ve-p-<token>-<id>` of a compiled preview e-mail into the canvas
 * attributes: the selectable element of each block gets `data-visual-editor-node`, and the
 * element holding an editable text gets `data-visual-editor-edit-node`. Only classes with the
 * token of this rendering count, each block is marked once (its first element in document
 * order), and the preview classes are taken out again. Works on the parsed tree, never by text
 * replacement. The e-mail that is sent has neither class nor attribute.
 *
 * `<mj-html-attributes>` was tried first and dropped: it re-serializes the whole body with
 * cheerio in XML mode, which turns `<br>` into an element that swallows the following text and
 * changes white space, so the preview would no longer be the e-mail that is sent.
 */
export class EmailPreviewMarker {
  mark(html: string, document: Pick<BlockDocument, 'blocks'>, token: string): string {
    const types = new Map<string, BlockNodeType>();
    const stack: Block[] = [...document.blocks];
    while (stack.length) {
      const block = stack.pop();
      if (!block) break;
      types.set(block.id, block.type);
      stack.push(...(block.children ?? []));
    }
    const prefix = `ve-p-${token}-`;
    const marked = new Set<string>();
    const tree = parse(html);
    this.walk(tree, (element) => {
      const id = this.take(element, prefix);
      const type = id ? types.get(id) : undefined;
      if (!id || !type || marked.has(id)) return;
      marked.add(id);
      this.annotate(element, id, type);
    });
    return serialize(tree);
  }

  /** Depth-first, in document order, `template` contents included. */
  private walk(root: DefaultTreeAdapterMap['parentNode'], visit: (element: Element) => void): void {
    const stack: DefaultTreeAdapterMap['childNode'][] = [...root.childNodes].reverse();
    while (stack.length) {
      const node = stack.pop();
      if (!node || !('tagName' in node)) continue;
      visit(node);
      const children = 'content' in node ? node.content.childNodes : node.childNodes;
      stack.push(...[...children].reverse());
    }
  }

  /** Removes the preview classes of this rendering and returns the block id they name. */
  private take(element: Element, prefix: string): string | undefined {
    const attribute = element.attrs.find((entry) => entry.name === 'class');
    if (!attribute) return undefined;
    let id: string | undefined;
    const kept = attribute.value.split(/\s+/).filter((token) => {
      if (!token.startsWith(prefix)) return token !== '';
      id ??= token.slice(prefix.length);
      return false;
    });
    if (id === undefined) return undefined;
    element.attrs = kept.length
      ? element.attrs.map((entry) =>
          entry === attribute ? { ...entry, value: kept.join(' ') } : entry,
        )
      : element.attrs.filter((entry) => entry !== attribute);
    return id;
  }

  private annotate(element: Element, id: string, type: BlockNodeType): void {
    this.set(element, NODE_ATTRIBUTE, id);
    const tags = EDITABLE[type];
    if (!tags) return;
    const target = this.descendant(element, tags);
    if (target) this.set(target, EDIT_NODE_ATTRIBUTE, id);
  }

  private descendant(element: Element, tags: readonly string[]): Element | undefined {
    const queue: Element[] = [];
    for (const child of element.childNodes) if ('tagName' in child) queue.push(child);
    while (queue.length) {
      const current = queue.shift();
      if (!current) break;
      if (tags.includes(current.tagName)) return current;
      for (const child of current.childNodes) if ('tagName' in child) queue.push(child);
    }
    return undefined;
  }

  private set(element: Element, name: string, value: string): void {
    element.attrs = [
      ...element.attrs.filter((attribute) => attribute.name !== name),
      { name, value },
    ];
  }
}
