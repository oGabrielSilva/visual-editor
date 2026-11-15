import type { DocumentNode, EditorDocumentData, SourceInput } from '../core/document';
import { EditorDocument } from '../core/document';
import { BlockCatalog } from '../core/catalog';
import { RichTextMarkup } from '../core/rich-text-markup';
import {
  RichTextFormatPolicy,
  RICH_TEXT_ORIGIN_ATTRIBUTE,
  RICH_TEXT_REMOVED_ATTRIBUTE,
} from '../core/rich-text-format';
import type { BlockType } from '../core/catalog';
import { ContentService } from './content-service';
import { EmailInsertionPlanner } from './email-insertion';
import type { EmailInsertionUnit, MutableNode } from './email-insertion';
import type { AssetReference } from './host';

/** Source of a block to insert. Generated e-mail blocks may state the unit they stand for. */
export interface InsertionSource extends SourceInput {
  readonly insertion?: EmailInsertionUnit;
}

const EMAIL_IMAGE_STYLE = 'display:block;max-width:100%;height:auto;border:0';
const PAGE_IMAGE_STYLE = 'max-width:100%;height:auto';

type MutableDocument = {
  -readonly [K in keyof EditorDocumentData]: K extends 'nodes'
    ? MutableNode[]
    : EditorDocumentData[K];
};

export class DocumentMutationService {
  private sequence = 0;
  private readonly formats = new RichTextFormatPolicy();
  private readonly markup = new RichTextMarkup();
  private readonly emails: EmailInsertionPlanner;
  constructor(
    private readonly content: ContentService,
    private readonly catalog: BlockCatalog,
  ) {
    this.emails = new EmailInsertionPlanner(
      () => this.id(),
      (style) => this.hidden(style),
    );
  }

  text(document: EditorDocumentData, id: string, value: string): EditorDocument {
    return this.mutate(document, id, (node) => {
      if (node.type === 'text') node.value = value;
      else {
        this.assertText(node);
        node.children = [{ id: this.id(), type: 'text', value }];
      }
    });
  }

  canEditRichText(document: EditorDocumentData, id: string): boolean {
    const node = this.find(document.nodes, id);
    return !!node && node.type === 'element' && this.catalog.canEditRichText(node);
  }

  validateRichTextProjection(document: EditorDocumentData, id: string, html: string): void {
    const imported = this.content.inspect({ html, css: '' }, document.kind);
    // A projection is written by the editor: anything the kind would remove makes it invalid.
    if (!imported.document || imported.diagnostics.some((item) => item.severity !== 'info'))
      throw new Error('Invalid rich text projection');
    this.content.assertWritable(imported.document.nodes);
    const violation = this.markup.violation(imported.document.nodes, 'block', {
      extraAttributes: [RICH_TEXT_ORIGIN_ATTRIBUTE, RICH_TEXT_REMOVED_ATTRIBUTE],
      style: (value) => !value || !!this.content.richTextStyles(value),
      element: (node) => {
        const removed = node.attrs?.[RICH_TEXT_REMOVED_ATTRIBUTE];
        return (
          removed === undefined ||
          (!!node.attrs?.[RICH_TEXT_ORIGIN_ATTRIBUTE] &&
            node.tag === 'span' &&
            this.formats.isFormat(removed))
        );
      },
    });
    if (violation === 'tag') throw new Error('Unsupported rich text projection');
    if (violation === 'attribute') throw new Error('Unsafe host projection attribute');
    if (violation === 'node') throw new Error('Invalid rich text removal');
    if (violation === 'style') throw new Error('Unsafe host projection style');
    const node = this.find(document.nodes, id);
    if (!node || node.type !== 'element' || !this.catalog.canEditRichText(node))
      throw new Error('Native content cannot be replaced');
    const children = this.richTextChildren(
      node,
      this.body(imported.document.nodes),
      document.nodes,
      document.css,
    );
    if (!this.catalog.acceptsRichText(node, children))
      throw new Error('Unsupported rich text content');
  }

  richText(document: EditorDocumentData, id: string, html: string): EditorDocument {
    const imported = this.content.inspect({ html, css: '' }, document.kind);
    if (!imported.document || imported.diagnostics.some((item) => item.severity !== 'info'))
      throw new Error('Invalid rich text');
    this.content.assertWritable(imported.document.nodes);
    const importedNodes = this.body(imported.document.nodes);
    return this.mutate(document, id, (node) => {
      if (!this.catalog.canEditRichText(node)) throw new Error('Native content cannot be replaced');
      const inlineOnly = !this.catalog.richTextAllowsBlocks(node);
      const paragraph =
        inlineOnly && importedNodes.length === 1 && importedNodes[0]?.tag === 'p'
          ? importedNodes[0]
          : undefined;
      const reconciled = this.restoreRichAttributes(
        paragraph?.children ?? importedNodes,
        node.children ?? [],
        document.nodes,
        document.css,
      );
      const children = this.unique(reconciled);
      if (!this.catalog.acceptsRichText(node, children))
        throw new Error('Unsupported rich text content');
      node.children = children;
    });
  }

  attribute(document: EditorDocumentData, id: string, name: string, value: string): EditorDocument {
    return this.mutate(document, id, (node) => {
      if (!this.catalog.acceptsProperty(node, name, 'attribute'))
        throw new Error('Unsupported visual attribute');
      this.content.assertWritable([
        { id: node.id, type: 'element', tag: node.tag ?? 'div', attrs: { [name]: value } },
      ]);
      node.attrs = { ...node.attrs, [name]: value };
    });
  }

  style(document: EditorDocumentData, id: string, property: string, value: string): EditorDocument {
    if (value.includes(';') || value.includes('{') || value.includes('}'))
      throw new Error('Unsupported visual style');
    return this.mutate(document, id, (node) => {
      if (!this.catalog.acceptsProperty(node, property, 'style'))
        throw new Error('Unsupported visual style');
      node.attrs = {
        ...node.attrs,
        style: this.content.setStyle(node.attrs?.style ?? '', property, value),
      };
    });
  }

  connectFormReference(
    document: EditorDocumentData,
    reference: string,
    id?: string,
    parentId?: string,
    index?: number,
  ): EditorDocument {
    if (document.kind !== 'page' || !/^[A-Za-z0-9_-]{1,128}$/.test(reference))
      throw new Error('Invalid form reference');
    if (id)
      return this.mutate(document, id, (node) => {
        if (
          node.type !== 'element' ||
          node.tag !== 'div' ||
          node.attrs?.['data-host-slot'] !== 'form' ||
          (node.children ?? []).length
        )
          throw new Error('Invalid form slot');
        node.attrs = { ...node.attrs, 'data-host-reference': reference };
      });
    return this.insert(
      document,
      {
        html: `<div data-host-slot="form" data-host-reference="${reference}"></div>`,
        css: '',
      },
      parentId,
      index,
    );
  }

  attachAsset(
    document: EditorDocumentData,
    asset: AssetReference,
    id?: string,
    parentId?: string,
    index?: number,
  ): EditorDocument {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(asset.id)) throw new Error('Invalid asset reference');
    this.content.assertWritable([
      { id: 'asset', type: 'element', tag: 'img', attrs: { src: asset.url, alt: asset.alt } },
    ]);
    if (id)
      return this.mutate(document, id, (node) => {
        if (node.type !== 'element' || node.tag !== 'img') throw new Error('Invalid image target');
        const attrs: Record<string, string> = {
          ...node.attrs,
          src: asset.url,
          alt: asset.alt,
          'data-host-asset-id': asset.id,
        };
        delete attrs['data-lyads-asset-id'];
        node.attrs = attrs;
      });
    const data = this.mutable(document);
    const parent = parentId ? this.find(data.nodes, parentId) : this.findTag(data.nodes, 'body');
    if (parentId && !parent) throw new Error('Missing parent');
    const image: MutableNode = {
      id: this.id(),
      type: 'element',
      tag: 'img',
      attrs: {
        src: asset.url,
        alt: asset.alt,
        style: document.kind === 'email' ? EMAIL_IMAGE_STYLE : PAGE_IMAGE_STYLE,
        'data-host-asset-id': asset.id,
      },
    };
    if (document.kind === 'email') {
      // The image is born inside a content cell, never loose between layout tables.
      const plan = this.emails.placeImage(data.nodes, parent, index, image);
      this.assertParent(plan.parent, plan.parent?.id, plan.nodes);
      plan.target.splice(plan.index, 0, ...plan.nodes.map((node) => this.copyNode(node)));
      return this.next(document, data);
    }
    this.assertParent(parent, parentId, [image]);
    const target = parent ? (parent.children ??= []) : data.nodes;
    target.splice(this.position(index, target.length), 0, image);
    return this.next(document, data);
  }

  insert(
    document: EditorDocumentData,
    source: InsertionSource,
    parentId?: string,
    index?: number,
  ): EditorDocument {
    const imported = this.content.inspect({ html: source.html, css: source.css }, document.kind);
    if (!imported.document || imported.diagnostics.some((item) => item.severity === 'error'))
      throw new Error('Invalid block');
    const data = this.mutable(document);
    const parent = parentId ? this.find(data.nodes, parentId) : this.findTag(data.nodes, 'body');
    if (parentId && !parent) throw new Error('Missing parent');
    const body = this.body(imported.document.nodes);
    const block = document.kind === 'email' ? this.emails.block(body) : undefined;
    if (block?.compiled) {
      // Only the unit which fits the destination travels: never the preheader, the article
      // wrapper or, inside a column, the section shell with its Outlook ghost table.
      const unit =
        source.insertion === 'content' || source.insertion === 'section'
          ? source.insertion
          : undefined;
      const plan = this.emails.place(data.nodes, parent, index, block, unit);
      const nodes = this.unique(plan.nodes);
      this.assertParent(plan.parent, plan.parent?.id, nodes);
      plan.target.splice(plan.index, 0, ...nodes);
    } else {
      const target = parent ? (parent.children ??= []) : data.nodes;
      const nodes = this.insertionNodes(this.unique(body), parent, document.kind);
      this.assertParent(parent, parentId, nodes);
      target.splice(this.position(index, target.length), 0, ...nodes);
    }
    const head = this.findTag(imported.document.nodes, 'head');
    const styles =
      head?.children
        ?.filter((node) => node.tag === 'style')
        .map((node) => (node.children ?? []).map((child) => child.value ?? '').join('')) ?? [];
    data.css = this.content.addDefaultStyles(data.css, [imported.document.css, ...styles]);
    return this.next(document, data);
  }

  add(
    document: EditorDocumentData,
    type: BlockType,
    parentId?: string,
    index?: number,
  ): EditorDocument {
    const data = this.mutable(document);
    const parent = parentId ? this.find(data.nodes, parentId) : this.findTag(data.nodes, 'body');
    const block = this.copyNode(this.catalog.create(type, this.id(), data.kind));
    this.assertParent(parent, parentId, [block]);
    const target = parent ? (parent.children ??= []) : data.nodes;
    target.splice(this.position(index, target.length), 0, block);
    return this.next(document, data);
  }

  remove(document: EditorDocumentData, id: string): EditorDocument {
    const data = this.mutable(document);
    const parent = this.parent(data.nodes, id);
    if (!parent) throw new Error('Missing node');
    this.assertStructuralEdit(parent.nodes[parent.index]);
    parent.nodes.splice(parent.index, 1);
    return this.next(document, data);
  }

  duplicate(document: EditorDocumentData, id: string): EditorDocument {
    const data = this.mutable(document);
    const parent = this.parent(data.nodes, id);
    if (!parent) throw new Error('Missing node');
    const original = parent.nodes[parent.index];
    if (!original) throw new Error('Missing node');
    this.assertStructuralEdit(original);
    const copies = this.unique([original]);
    const clearIdentities = (nodes: MutableNode[]): void => {
      for (const node of nodes) {
        if (node.attrs) {
          delete node.attrs.id;
          delete node.attrs.name;
        }
        clearIdentities(node.children ?? []);
      }
    };
    clearIdentities(copies);
    parent.nodes.splice(parent.index + 1, 0, ...copies);
    return this.next(document, data);
  }

  move(
    document: EditorDocumentData,
    id: string,
    parentId: string | undefined,
    index: number,
  ): EditorDocument {
    const data = this.mutable(document);
    const source = this.parent(data.nodes, id);
    const node = source?.nodes[source.index];
    if (!source || !node) throw new Error('Missing node');
    this.assertStructuralEdit(node);
    if (parentId && (parentId === id || this.find(node.children ?? [], parentId)))
      throw new Error('Cyclic move');
    const parent = parentId ? this.find(data.nodes, parentId) : this.findTag(data.nodes, 'body');
    this.assertParent(parent, parentId, [node]);
    const target = parent ? (parent.children ??= []) : data.nodes;
    const finalLength = target.length - (source.nodes === target ? 1 : 0);
    const position = this.position(index, finalLength);
    source.nodes.splice(source.index, 1);
    target.splice(position, 0, node);
    return this.next(document, data);
  }

  private richTextChildren(
    parent: DocumentNode,
    imported: readonly DocumentNode[],
    documentNodes: readonly DocumentNode[],
    documentCss: string,
  ): readonly DocumentNode[] {
    const paragraph =
      !this.catalog.richTextAllowsBlocks(parent) &&
      imported.length === 1 &&
      imported[0]?.tag === 'p'
        ? imported[0]
        : undefined;
    return this.restoreRichAttributes(
      paragraph?.children ?? imported,
      parent.children ?? [],
      documentNodes,
      documentCss,
    );
  }

  private insertionNodes(
    nodes: MutableNode[],
    parent: MutableNode | undefined,
    kind: EditorDocumentData['kind'],
  ): MutableNode[] {
    if (kind !== 'email' || !parent || this.catalog.acceptsChildren(parent, nodes)) return nodes;
    // Generated email snippets keep their native HTML envelope inside a valid table unit.
    // This composes new MJML output; it does not reverse-compile an imported document.
    if (['tbody', 'thead', 'tfoot'].includes(parent.tag ?? '')) {
      return [
        {
          id: this.id(),
          type: 'element',
          tag: 'tr',
          children: [{ id: this.id(), type: 'element', tag: 'td', children: nodes }],
        },
      ];
    }
    if (parent.tag === 'tr')
      return [{ id: this.id(), type: 'element', tag: 'td', children: nodes }];
    return nodes;
  }

  private restoreRichAttributes(
    next: readonly DocumentNode[],
    previous: readonly DocumentNode[],
    documentNodes: readonly DocumentNode[],
    documentCss: string,
  ): readonly DocumentNode[] {
    const originals = new Map<string, DocumentNode>();
    const collect = (nodes: readonly DocumentNode[]): void => {
      for (const node of nodes) {
        originals.set(node.id, node);
        collect(node.children ?? []);
      }
    };
    collect(previous);
    const identities = new Map<string, Set<string>>();
    const collectIdentities = (nodes: readonly DocumentNode[]): void => {
      for (const node of nodes) {
        for (const value of [node.attrs?.id, node.attrs?.name]) {
          if (!value) continue;
          const owners = identities.get(value) ?? new Set<string>();
          owners.add(node.id);
          identities.set(value, owners);
        }
        collectIdentities(node.children ?? []);
      }
    };
    collectIdentities(documentNodes);
    let decorationRules: boolean | undefined;
    const ambiguousDecoration = (): boolean => {
      if (decorationRules !== undefined) return decorationRules;
      const stylesheets = [documentCss];
      const collectStylesheets = (nodes: readonly DocumentNode[]): void => {
        for (const node of nodes) {
          if (node.tag === 'style')
            stylesheets.push((node.children ?? []).map((child) => child.value ?? '').join(''));
          collectStylesheets(node.children ?? []);
        }
      };
      collectStylesheets(documentNodes);
      decorationRules = stylesheets.some((css) => this.content.hasDecorationRules(css));
      return decorationRules;
    };
    const used = new Set<string>();
    const equivalent = (tag: string | undefined): string | undefined =>
      (({ b: 'strong', i: 'em', small: 'span' }) as Readonly<Record<string, string>>)[tag ?? ''] ??
      tag;
    const restore = (nodes: readonly DocumentNode[]): readonly DocumentNode[] =>
      nodes.map((node) => {
        if (node.type !== 'element') return node;
        const origin = node.attrs?.[RICH_TEXT_ORIGIN_ATTRIBUTE];
        const original = origin ? originals.get(origin) : undefined;
        const removed = node.attrs?.[RICH_TEXT_REMOVED_ATTRIBUTE];
        if (removed !== undefined) {
          if (!origin || !original || !this.formats.canRemove(original.tag, node.tag, removed))
            throw new Error('Invalid rich text removal');
        } else if (origin && (!original || equivalent(original.tag) !== equivalent(node.tag)))
          throw new Error('Invalid rich text origin');
        const split = !!origin && used.has(origin);
        if (origin) used.add(origin);
        const attrs = { ...original?.attrs, ...node.attrs };
        if (node.attrs?.style)
          attrs.style = this.content.mergeRichTextStyle(
            original?.attrs?.style ?? '',
            node.attrs.style,
          );
        delete attrs[RICH_TEXT_ORIGIN_ATTRIBUTE];
        delete attrs[RICH_TEXT_REMOVED_ATTRIBUTE];
        if (this.formats.isFormat(removed)) {
          for (const attribute of this.formats.removedAttributes(removed)) delete attrs[attribute];
          if (removed === 'link' && attrs.name) {
            const owners = identities.get(attrs.name);
            if (!attrs.id && owners?.size === 1 && original && owners.has(original.id))
              attrs.id = attrs.name;
            delete attrs.name;
          }
          for (const [property, value] of Object.entries(this.formats.resets(removed)))
            attrs.style = this.content.setStyle(attrs.style ?? '', property, value);
          const decoration = this.formats.decorationFor(removed);
          if (decoration) {
            if (ambiguousDecoration()) throw new Error('AMBIGUOUS_TEXT_DECORATION');
            attrs.style = this.content.removeDecoration(attrs.style ?? '', decoration);
          }
        }
        // Rich editors split a mark/paragraph when formatting or pressing Enter.
        // Safe presentation attributes follow each segment; HTML identity stays unique.
        if (split) {
          delete attrs.id;
          delete attrs.name;
        }
        return {
          ...node,
          ...(removed !== undefined ? { tag: 'span' } : original?.tag ? { tag: original.tag } : {}),
          ...(Object.keys(attrs).length ? { attrs } : { attrs: {} }),
          ...(node.children ? { children: restore(node.children) } : {}),
        };
      });
    return restore(next);
  }

  private mutate(
    document: EditorDocumentData,
    id: string,
    change: (node: MutableNode) => void,
  ): EditorDocument {
    const data = this.mutable(document);
    const node = this.find(data.nodes, id);
    if (!node) throw new Error('Missing node');
    change(node);
    return this.next(document, data);
  }

  private next(previous: EditorDocumentData, next: MutableDocument): EditorDocument {
    next.revision = previous.revision + 1;
    return this.content.document(next);
  }

  private id(): string {
    return `inserted-${Date.now().toString(36)}-${++this.sequence}`;
  }

  private hidden(style: string): boolean {
    if (!style.trim()) return false;
    try {
      return this.content.inlineDeclarations(style).display === 'none';
    } catch {
      return false;
    }
  }
  private position(index: number | undefined, length: number): number {
    if (index === undefined) return length;
    if (!Number.isInteger(index) || index < 0 || index > length)
      throw new Error('Invalid insertion index');
    return index;
  }

  private find(nodes: MutableNode[], id: string): MutableNode | undefined;
  private find(nodes: readonly DocumentNode[], id: string): DocumentNode | undefined;
  private find(nodes: readonly DocumentNode[], id: string): DocumentNode | undefined {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = this.find(node.children ?? [], id);
      if (found) return found;
    }
    return undefined;
  }

  private findTag(nodes: MutableNode[], tag: string): MutableNode | undefined;
  private findTag(nodes: readonly DocumentNode[], tag: string): DocumentNode | undefined;
  private findTag(nodes: readonly DocumentNode[], tag: string): DocumentNode | undefined {
    for (const node of nodes) {
      if (node.tag === tag) return node;
      const found = this.findTag(node.children ?? [], tag);
      if (found) return found;
    }
    return undefined;
  }

  private parent(
    nodes: MutableNode[],
    id: string,
  ): { nodes: MutableNode[]; index: number } | undefined {
    const index = nodes.findIndex((node) => node.id === id);
    if (index >= 0) return { nodes, index };
    for (const node of nodes) {
      const found = this.parent(node.children ?? [], id);
      if (found) return found;
    }
    return undefined;
  }

  private body(nodes: readonly DocumentNode[]): readonly DocumentNode[] {
    return (
      this.findTag(nodes, 'body')?.children ??
      nodes.filter((node) => node.type !== 'doctype' && node.tag !== 'head')
    );
  }

  private assertText(node: MutableNode): void {
    if (!this.catalog.canEditText(node)) throw new Error('Native content cannot be replaced');
  }

  private assertStructuralEdit(node: MutableNode | undefined): void {
    if (
      !node ||
      node.type === 'doctype' ||
      ['html', 'head', 'body', 'meta', 'style', 'title'].includes(node.tag ?? '')
    )
      throw new Error('Document infrastructure is not a content block');
  }

  private assertParent(
    parent: MutableNode | undefined,
    id: string | undefined,
    children: readonly DocumentNode[],
  ): void {
    if (id && !parent) throw new Error('Missing parent');
    if (!parent) {
      if (!this.catalog.acceptsRootChildren(children)) throw new Error('Unsupported root content');
      return;
    }
    if (!this.catalog.acceptsChildren(parent, children))
      throw new Error('Unsupported insertion parent');
  }
  private unique(nodes: readonly DocumentNode[]): MutableNode[] {
    return nodes.map((node) => {
      const clone = this.copyNode(node);
      clone.id = this.id();
      // Source positions and recognition belong to the original. How a comment was written
      // (`<![if !mso]>`, `<?xml ?>`) is part of what it means and travels with the copy.
      const opener = clone.metadata?.commentOpener;
      delete clone.metadata;
      if (opener !== undefined) clone.metadata = { commentOpener: opener };
      if (clone.children) clone.children = this.unique(clone.children);
      return clone;
    });
  }

  private mutable(document: EditorDocumentData): MutableDocument {
    return { ...document, nodes: document.nodes.map((node) => this.copyNode(node)) };
  }

  private copyNode(node: DocumentNode): MutableNode {
    return {
      id: node.id,
      type: node.type,
      ...(node.tag !== undefined ? { tag: node.tag } : {}),
      ...(node.value !== undefined ? { value: node.value } : {}),
      ...(node.attrs ? { attrs: { ...node.attrs } } : {}),
      ...(node.children ? { children: node.children.map((child) => this.copyNode(child)) } : {}),
      ...(node.metadata ? { metadata: { ...node.metadata } } : {}),
    };
  }
}
