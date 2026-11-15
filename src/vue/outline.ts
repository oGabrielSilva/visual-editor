import type { DocumentNode, EditorDocumentData } from '../core/document';
import { BlockCatalog } from '../core/catalog';
import { CanvasLayout } from '../core/canvas-layout';
import { escapeHtml } from '../core/html-escape';
import { UrlPolicy } from '../security/url-policy';
import { RichTextProjectionRules } from '../rich-text/projection-rules';

export interface OutlineEntry {
  readonly id: string;
  readonly parentId: string | null;
  readonly index: number;
  readonly depth: number;
  readonly tag: string;
  readonly label: string;
  readonly labelKey?: string;
  readonly node: DocumentNode;
}

/** Projects editable text without bringing document styles/classes into the host DOM. */
export class DocumentOutline {
  private readonly capabilities: BlockCatalog;
  private readonly layout: CanvasLayout;
  private readonly rules = new RichTextProjectionRules();
  constructor(
    private readonly urls = new UrlPolicy(),
    capabilities?: BlockCatalog,
    layout?: CanvasLayout,
  ) {
    this.capabilities = capabilities ?? new BlockCatalog();
    this.layout = layout ?? new CanvasLayout(this.capabilities);
  }

  entries(document: EditorDocumentData): readonly OutlineEntry[] {
    return this.layout.selectionRegions(document).map((region) => {
      const content = this.text(region.node).trim();
      return {
        id: region.id,
        parentId: region.parentId,
        index: region.index,
        depth: region.depth,
        tag: region.node.tag ?? '',
        label: content.slice(0, 75) || region.node.attrs?.alt || region.node.tag || '',
        ...(!content && !region.node.attrs?.alt && region.labelKey
          ? { labelKey: region.labelKey }
          : {}),
        node: region.node,
      };
    });
  }

  text(node: DocumentNode): string {
    return node.type === 'text'
      ? (node.value ?? '')
      : (node.children ?? []).map((child) => this.text(child)).join('');
  }

  editableTextNode(node: DocumentNode): DocumentNode | undefined {
    if (node.type === 'text') return node;
    return (node.children ?? []).find((child) => child.type === 'text');
  }

  richText(node: DocumentNode): string | undefined {
    if (node.type !== 'element' || !this.capabilities.canEditRichText(node)) return undefined;
    const rules = this.rules;
    const blocks = { has: (tag: string): boolean => rules.isBlock(tag) };
    const serialize = (entry: DocumentNode): string | undefined => {
      if (entry.type === 'text') return escapeHtml(entry.value ?? '');
      if (entry.type !== 'element' || !rules.supports(entry.tag ?? '')) return undefined;
      const tag = rules.canonicalTag(entry.tag ?? '');
      const allowed = rules.semanticAttributes(tag);
      const attributes = Object.entries(entry.attrs ?? {}).filter(([name]) =>
        allowed.includes(name),
      );
      if (attributes.some(([name, value]) => name === 'href' && !this.urls.isSafe(value, 'link')))
        return undefined;
      if (rules.needsOrigin(entry.tag ?? '', Object.keys(entry.attrs ?? {})))
        attributes.push(['data-editor-rich-origin', entry.id]);
      const attrs = attributes.map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join('');
      const children = (entry.children ?? []).map(serialize);
      if (children.includes(undefined)) return undefined;
      return tag === 'br' || tag === 'hr'
        ? `<${tag}${attrs}>`
        : `<${tag}${attrs}>${children.join('')}</${tag}>`;
    };
    const children = (node.children ?? []).map(serialize);
    if (children.includes(undefined)) return undefined;
    const content = children.join('');
    const hasBlocks = (node.children ?? []).some((child) => blocks.has(child.tag ?? ''));
    if (this.capabilities.richTextAllowsBlocks(node) && hasBlocks) {
      // Normalize mixed text/block content for the rich editor while preserving each block.
      const normalized: string[] = [];
      let inlineContent = '';
      (node.children ?? []).forEach((child, index) => {
        if (blocks.has(child.tag ?? '')) {
          if (inlineContent.trim()) normalized.push(`<p>${inlineContent}</p>`);
          inlineContent = '';
          normalized.push(children[index] ?? '');
        } else inlineContent += children[index] ?? '';
      });
      if (inlineContent.trim()) normalized.push(`<p>${inlineContent}</p>`);
      return normalized.join('');
    }
    return `<p>${content}</p>`;
  }
}
