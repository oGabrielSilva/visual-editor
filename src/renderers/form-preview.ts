import { defaultTreeAdapter, html, parseFragment } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { stripReservedAttributes } from './markup-tree';
import type { MarkupElement, MarkupParent } from './markup-tree';

/** Reads the picture the host sent for a form reference, if it already arrived. */
export type FormPreviewLookup = (reference: string) => string | undefined;

type ChildNode = DefaultTreeAdapterMap['childNode'];

/** Elements a picture of a form never needs: active, framing or document-level content. */
const DROPPED_ELEMENTS = new Set([
  'script',
  'style',
  'link',
  'meta',
  'base',
  'title',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'portal',
  'template',
  'noscript',
  'svg',
  'math',
  'audio',
  'video',
  'source',
  'track',
  'dialog',
]);
/** Attributes which load or send something; only an image from `https:` or `data:image/` stays. */
const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'srcset',
  'action',
  'formaction',
  'poster',
  'background',
  'ping',
  'xlink:href',
]);
const SAFE_IMAGE = /^(?:https:|data:image\/(?:png|jpeg|gif|webp);)/i;

/**
 * Puts the host's picture of each connected form inside its slot, in the canvas only. The slot
 * keeps its mark, so a click on the picture still selects the slot; the picture is inert, has no
 * marks of its own and cannot run anything (the frame's policy blocks scripts anyway).
 */
export class FormPreviewInjector {
  inject(body: MarkupElement, lookup: FormPreviewLookup): void {
    const stack: MarkupParent[] = [body];
    while (stack.length) {
      const parent = stack.pop();
      if (!parent) break;
      for (const node of parent.childNodes) {
        if (!defaultTreeAdapter.isElementNode(node)) continue;
        const reference = this.reference(node);
        if (reference === undefined) {
          stack.push(node);
          continue;
        }
        const source = lookup(reference);
        if (source !== undefined) this.fill(node, source);
      }
    }
  }

  /** The reference of an empty, connected form slot; anything else is not a slot to fill. */
  private reference(node: MarkupElement): string | undefined {
    const attribute = (name: string): string | undefined =>
      node.attrs.find((entry) => entry.name === name)?.value;
    if (attribute('data-host-slot') !== 'form') return undefined;
    const reference = attribute('data-host-reference');
    if (!reference || !/^[A-Za-z0-9_-]{1,128}$/.test(reference)) return undefined;
    if (node.childNodes.some((child) => defaultTreeAdapter.isElementNode(child))) return undefined;
    return reference;
  }

  private fill(slot: MarkupElement, source: string): void {
    const fragment = parseFragment(source);
    this.clean(fragment);
    stripReservedAttributes(fragment);
    if (!fragment.childNodes.some((node) => defaultTreeAdapter.isElementNode(node))) return;
    const wrapper = defaultTreeAdapter.createElement('div', html.NS.HTML, [
      { name: 'data-editor-form-preview', value: '' },
      { name: 'inert', value: '' },
      { name: 'aria-hidden', value: 'true' },
      { name: 'style', value: 'pointer-events:none;user-select:none' },
    ]);
    for (const node of [...fragment.childNodes]) defaultTreeAdapter.appendChild(wrapper, node);
    slot.childNodes = slot.childNodes.filter((node) => !defaultTreeAdapter.isTextNode(node));
    defaultTreeAdapter.appendChild(slot, wrapper);
  }

  private clean(parent: MarkupParent): void {
    const kept: ChildNode[] = [];
    for (const node of parent.childNodes) {
      if (defaultTreeAdapter.isCommentNode(node)) continue;
      if (defaultTreeAdapter.isElementNode(node)) {
        if (DROPPED_ELEMENTS.has(node.tagName) || node.namespaceURI !== html.NS.HTML) continue;
        node.attrs = node.attrs.filter((attribute) => this.allowed(node.tagName, attribute));
        this.clean(node);
      }
      kept.push(node);
    }
    parent.childNodes = kept;
  }

  private allowed(tag: string, attribute: { name: string; value: string }): boolean {
    const name = attribute.name.toLowerCase();
    if (name.startsWith('on') || name === 'id' || name === 'autofocus' || name === 'form')
      return false;
    if (URL_ATTRIBUTES.has(name))
      return tag === 'img' && name === 'src' && SAFE_IMAGE.test(attribute.value.trim());
    if (name === 'style') return !/url\s*\(|expression\s*\(|@import/i.test(attribute.value);
    return true;
  }
}
