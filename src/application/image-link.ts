import type { DocumentNode, EditorDocumentData } from '../core/document';
import { EditorDocument } from '../core/document';
import { ContentService } from './content-service';

export interface ImageLinkOptions {
  readonly target?: '_blank' | '_self';
}
export interface ImageLinkContext {
  readonly imageId: string;
  readonly anchorId?: string;
  readonly href: string;
  readonly target: string;
  readonly rel: string;
  readonly shared: boolean;
  readonly editable: boolean;
  readonly reason?: 'shared-structure' | 'shared-identity' | 'nested-link';
}
export interface ImageLinkUrlPort {
  isSafe(value: string, purpose: 'link'): boolean;
}
export interface ImageLinkIdentityPort {
  next(): string;
}
interface ImageLinkLocation {
  readonly image: DocumentNode;
  readonly anchor?: DocumentNode;
  readonly branch?: DocumentNode;
  readonly shared: boolean;
  readonly editable: boolean;
  readonly reason?: ImageLinkContext['reason'];
}

/** Changes the link of one image while retaining unrelated content and link destinations. */
export class ImageLinkService {
  constructor(
    private readonly content: ContentService,
    private readonly urls: ImageLinkUrlPort,
    private readonly identifiers: ImageLinkIdentityPort,
  ) {}

  context(document: EditorDocumentData, imageId: string): ImageLinkContext | undefined {
    const location = this.locate(document, imageId);
    if (!location) return undefined;
    return {
      imageId: location.image.id,
      ...(location.anchor ? { anchorId: location.anchor.id } : {}),
      href: location.anchor?.attrs?.href ?? '',
      target: location.anchor?.attrs?.target ?? '_self',
      rel: location.anchor?.attrs?.rel ?? '',
      shared: location.shared,
      editable: location.editable,
      ...(location.reason ? { reason: location.reason } : {}),
    };
  }

  update(
    document: EditorDocumentData,
    imageId: string,
    href: string,
    options: ImageLinkOptions = {},
  ): EditorDocument {
    if (typeof href !== 'string' || !this.urls.isSafe(href, 'link'))
      throw new Error('IMAGE_LINK_INVALID_URL');
    if (options.target !== undefined && !['_blank', '_self'].includes(options.target))
      throw new Error('IMAGE_LINK_INVALID_TARGET');
    const location = this.locate(document, imageId);
    if (!location || !location.editable) throw new Error('IMAGE_LINK_UNSUPPORTED_CONTEXT');
    const value = href.trim();
    const ids = new Set<string>();
    const collect = (nodes: readonly DocumentNode[]): void => {
      for (const node of nodes) {
        ids.add(node.id);
        collect(node.children ?? []);
      }
    };
    collect(document.nodes);
    const freshId = (): string => {
      for (let attempt = 0; attempt < 16; attempt++) {
        const id = `image-link-${this.identifiers.next()}`;
        if (!ids.has(id)) {
          ids.add(id);
          return id;
        }
      }
      throw new Error('IMAGE_LINK_IDENTITY_UNAVAILABLE');
    };
    const anchor = location.anchor;
    const attrs = this.attributes(anchor, value, options);
    let targetId: string;
    let replacement: readonly DocumentNode[];
    if (!anchor) {
      if (!value) return this.content.document(document);
      targetId = location.image.id;
      replacement = [
        { id: freshId(), type: 'element', tag: 'a', attrs, children: [location.image] },
      ];
    } else if (!location.shared) {
      targetId = anchor.id;
      replacement = value ? [{ ...anchor, attrs }] : (anchor.children ?? []);
    } else {
      const branch = location.branch;
      if (!branch) throw new Error('IMAGE_LINK_UNSUPPORTED_CONTEXT');
      const children = anchor.children ?? [];
      const position = children.findIndex((node) => node.id === branch.id);
      if (position < 0) throw new Error('IMAGE_LINK_UNSUPPORTED_CONTEXT');
      const before = children.slice(0, position);
      const after = children.slice(position + 1);
      const pieces: DocumentNode[] = [];
      let originalUsed = false;
      const retain = (nodes: readonly DocumentNode[]): void => {
        if (!nodes.length) return;
        pieces.push({
          id: originalUsed ? freshId() : anchor.id,
          type: 'element',
          tag: 'a',
          ...(anchor.attrs ? { attrs: { ...anchor.attrs } } : {}),
          children: nodes,
        });
        originalUsed = true;
      };
      retain(before);
      pieces.push(
        value ? { id: freshId(), type: 'element', tag: 'a', attrs, children: [branch] } : branch,
      );
      retain(after);
      targetId = anchor.id;
      replacement = pieces;
    }
    const nodes = this.replace(document.nodes, targetId, replacement);
    return this.content.document(EditorDocument.from(document).withChanges({ nodes }).snapshot());
  }

  private attributes(
    anchor: DocumentNode | undefined,
    href: string,
    options: ImageLinkOptions,
  ): Readonly<Record<string, string>> {
    const attrs: Record<string, string> = { ...anchor?.attrs, href };
    if (options.target !== undefined) attrs.target = options.target;
    if (attrs.target === '_blank') {
      const rel = new Set((attrs.rel ?? '').split(/\s+/).filter(Boolean));
      rel.delete('opener');
      rel.add('noopener');
      rel.add('noreferrer');
      attrs.rel = [...rel].join(' ');
    }
    return attrs;
  }

  private locate(document: EditorDocumentData, imageId: string): ImageLinkLocation | undefined {
    const path = this.path(document.nodes, imageId);
    const image = path?.at(-1);
    if (!path || image?.type !== 'element' || image.tag !== 'img') return undefined;
    const anchors = path.filter((node) => node.tag === 'a');
    const anchor = anchors.at(-1);
    if (!anchor) return { image, shared: false, editable: true };
    if (anchors.length !== 1)
      return { image, anchor, shared: true, editable: false, reason: 'nested-link' };
    const anchorIndex = path.findIndex((node) => node.id === anchor.id);
    const branch = path[anchorIndex + 1];
    if (!branch) return undefined;
    const exclusiveBranch = path.slice(anchorIndex + 1, -1).every((node, offset) => {
      const next = path[anchorIndex + 2 + offset];
      return (node.children ?? []).every(
        (child) => child.id === next?.id || !this.substantive(child),
      );
    });
    const shared =
      !exclusiveBranch ||
      (anchor.children ?? []).some((node) => node.id !== branch.id && this.substantive(node));
    if (!exclusiveBranch)
      return { image, anchor, branch, shared, editable: false, reason: 'shared-structure' };
    if (shared && (anchor.attrs?.id || anchor.attrs?.name))
      return { image, anchor, branch, shared, editable: false, reason: 'shared-identity' };
    return { image, anchor, branch, shared, editable: true };
  }

  private substantive(node: DocumentNode): boolean {
    return node.type !== 'text' || !!node.value?.trim();
  }

  private path(
    nodes: readonly DocumentNode[],
    id: string,
    parents: readonly DocumentNode[] = [],
  ): readonly DocumentNode[] | undefined {
    for (const node of nodes) {
      if (node.id === id) return [...parents, node];
      const found = this.path(node.children ?? [], id, [...parents, node]);
      if (found) return found;
    }
    return undefined;
  }

  private replace(
    nodes: readonly DocumentNode[],
    id: string,
    replacement: readonly DocumentNode[],
  ): readonly DocumentNode[] {
    return nodes.flatMap((node) => {
      if (node.id === id) return replacement;
      return node.children
        ? [{ ...node, children: this.replace(node.children, id, replacement) }]
        : [node];
    });
  }
}
