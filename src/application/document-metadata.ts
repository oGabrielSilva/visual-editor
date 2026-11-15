import type { DocumentNode, EditorDocumentData } from '../core/document';
import { EditorDocument } from '../core/document';
import { ContentService } from './content-service';
import type { MutableNode } from './email-insertion';

export interface DocumentMetadata {
  readonly title: string;
  /** Hidden preview text of an e-mail; undefined for a page, empty when there is none. */
  readonly preheader: string | undefined;
}

export interface MetadataIdentityPort {
  next(): string;
}

/** What MJML itself writes for `mj-preview`: hidden from the message, read by the inbox. */
const PREHEADER_STYLE =
  'display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;';
const TITLE_LIMIT = 1_000;
const PREHEADER_LIMIT = 500;

/**
 * Title and preheader are part of what a recipient receives, so they are document content
 * edited by commands like any other, never sample text left behind by a template.
 */
export class DocumentMetadataService {
  constructor(
    private readonly content: ContentService,
    private readonly identifiers: MetadataIdentityPort,
  ) {}

  read(document: EditorDocumentData): DocumentMetadata {
    const preheader = document.kind === 'email' ? this.preheaderNode(document.nodes) : undefined;
    return {
      title: document.title,
      preheader: document.kind === 'email' ? (preheader ? this.text(preheader) : '') : undefined,
    };
  }

  title(document: EditorDocumentData, value: string): EditorDocument {
    if (typeof value !== 'string' || value.length > TITLE_LIMIT || this.control(value))
      throw new Error('Invalid document title');
    const nodes = document.nodes.map((node) => this.copy(node));
    const head = this.findTag(nodes, 'head');
    if (head) {
      const children = (head.children ??= []);
      let title = children.find((node) => node.tag === 'title');
      if (!title) {
        title = { id: this.identifiers.next(), type: 'element', tag: 'title' };
        children.push(title);
      }
      title.children = value ? [{ id: this.identifiers.next(), type: 'text', value }] : [];
    }
    return this.next(document, nodes, value);
  }

  preheader(document: EditorDocumentData, value: string): EditorDocument {
    if (
      document.kind !== 'email' ||
      typeof value !== 'string' ||
      value.length > PREHEADER_LIMIT ||
      this.control(value)
    )
      throw new Error('Invalid preheader');
    const nodes = document.nodes.map((node) => this.copy(node));
    const body = this.findTag(nodes, 'body');
    const siblings = body ? (body.children ??= []) : nodes;
    const existing = this.preheaderNode(siblings, true);
    if (existing) {
      if (value) existing.children = [{ id: this.identifiers.next(), type: 'text', value }];
      else siblings.splice(siblings.indexOf(existing), 1);
    } else if (value) {
      const first = siblings.findIndex((node) => node.type !== 'doctype');
      siblings.splice(first < 0 ? siblings.length : first, 0, {
        id: this.identifiers.next(),
        type: 'element',
        tag: 'div',
        attrs: { style: PREHEADER_STYLE },
        children: [{ id: this.identifiers.next(), type: 'text', value }],
      });
    }
    return this.next(document, nodes, document.title);
  }

  /** The first content of the body when it is a hidden block which only holds text. */
  private preheaderNode(nodes: MutableNode[], direct: true): MutableNode | undefined;
  private preheaderNode(nodes: readonly DocumentNode[]): DocumentNode | undefined;
  private preheaderNode(nodes: readonly DocumentNode[], direct = false): DocumentNode | undefined {
    const siblings = direct ? nodes : (this.findTag(nodes, 'body')?.children ?? nodes);
    const first = siblings.find(
      (node) => node.type === 'element' || (node.type === 'text' && !!node.value?.trim()),
    );
    if (
      first?.type !== 'element' ||
      first.tag !== 'div' ||
      (first.children ?? []).some((child) => child.type !== 'text')
    )
      return undefined;
    try {
      return this.content.inlineDeclarations(first.attrs?.style ?? '').display === 'none'
        ? first
        : undefined;
    } catch {
      return undefined;
    }
  }

  private next(
    previous: EditorDocumentData,
    nodes: readonly DocumentNode[],
    title: string,
  ): EditorDocument {
    return this.content.document({ ...previous, title, nodes, revision: previous.revision + 1 });
  }

  private text(node: DocumentNode): string {
    return (node.children ?? []).map((child) => child.value ?? '').join('');
  }

  private control(value: string): boolean {
    return [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
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

  private copy(node: DocumentNode): MutableNode {
    return {
      id: node.id,
      type: node.type,
      ...(node.tag !== undefined ? { tag: node.tag } : {}),
      ...(node.value !== undefined ? { value: node.value } : {}),
      ...(node.attrs ? { attrs: { ...node.attrs } } : {}),
      ...(node.children ? { children: node.children.map((child) => this.copy(child)) } : {}),
      ...(node.metadata ? { metadata: { ...node.metadata } } : {}),
    };
  }
}
