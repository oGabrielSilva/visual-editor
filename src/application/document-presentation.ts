import {
  DocumentPresentationPolicy,
  DOCUMENT_STYLE_PROPERTIES,
} from '../core/document-presentation';
import type { DocumentStyleProperty, ImageSizeSettings } from '../core/document-presentation';
import { EditorDocument } from '../core/document';
import type { DocumentNode, EditorDocumentData } from '../core/document';
import { ContentService } from './content-service';

export { IMAGE_SIZE_LIMITS, DOCUMENT_STYLE_PROPERTIES } from '../core/document-presentation';
export type { DocumentStyleProperty, ImageSizeSettings } from '../core/document-presentation';

export interface ImageSizeContext {
  readonly id: string;
  readonly width?: number;
  readonly height?: number;
  readonly ratio?: number;
}
export interface DocumentStyleContext {
  readonly id: string;
  readonly properties: typeof DOCUMENT_STYLE_PROPERTIES;
  readonly originalProperties: readonly DocumentStyleProperty[];
  readonly values: Readonly<Partial<Record<DocumentStyleProperty, string>>>;
}

/** Presentation changes are one validated document transaction, never DOM mutations. */
export class DocumentPresentationService {
  private readonly settings = new DocumentPresentationPolicy();
  constructor(private readonly content: ContentService) {}

  image(document: EditorDocumentData, id: string): ImageSizeContext | undefined {
    const node = this.find(document.nodes, id);
    if (node?.tag !== 'img') return undefined;
    const styles = this.content.inlineDeclarations(node.attrs?.style ?? '');
    const width =
      this.pixels(styles.width) ?? (styles.width ? undefined : this.number(node.attrs?.width));
    const height =
      this.pixels(styles.height) ?? (styles.height ? undefined : this.number(node.attrs?.height));
    const declaredRatio =
      styles.height === 'auto' || (!styles.height && !node.attrs?.height)
        ? this.ratio(styles['aspect-ratio'])
        : undefined;
    return {
      id,
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      ...(declaredRatio
        ? { ratio: declaredRatio }
        : width && height
          ? { ratio: width / height }
          : {}),
    };
  }

  resize(document: EditorDocumentData, id: string, input: ImageSizeSettings): EditorDocument {
    const settings = this.settings.image(input);
    const current = this.image(document, id);
    const node = this.find(document.nodes, id);
    if (!current || !node) throw new Error('UNSUPPORTED_IMAGE_SIZE');
    if (settings.preserveRatio && !current.ratio) throw new Error('UNKNOWN_IMAGE_RATIO');
    if (settings.preserveRatio && settings.height !== undefined)
      throw new Error('AMBIGUOUS_IMAGE_SIZE');
    const height = settings.preserveRatio
      ? Math.round((settings.width / current.ratio!) * 1000) / 1000
      : settings.height;
    if (height !== undefined) this.settings.dimension(height);
    const attrs: Record<string, string> = { ...node.attrs, width: String(settings.width) };
    let style = this.content.setStyle(attrs.style ?? '', 'width', `${settings.width}px`);
    style = this.content.setStyle(style, 'max-width', '100%');
    style = this.content.setStyle(
      style,
      'height',
      settings.preserveRatio || height === undefined ? 'auto' : `${height}px`,
    );
    style = settings.preserveRatio
      ? this.content.setStyle(style, 'aspect-ratio', `${settings.width}/${height}`)
      : this.content.withoutStyles(style, ['aspect-ratio']);
    attrs.style = style;
    if (height === undefined) delete attrs.height;
    else attrs.height = String(height);
    return this.change(document, id, { ...node, attrs });
  }

  styles(document: EditorDocumentData): DocumentStyleContext | undefined {
    const all = this.all(document.nodes);
    const elements = document.nodes.filter((node) => node.type === 'element');
    const root =
      all.find((node) => node.tag === 'body') ??
      (elements.length === 1 &&
      ['main', 'div', 'section', 'article'].includes(elements[0]?.tag ?? '')
        ? elements[0]
        : undefined);
    if (!root) return undefined;
    const declarations = this.content.inlineDeclarations(root.attrs?.style ?? '');
    const values: Partial<Record<DocumentStyleProperty, string>> = {};
    for (const property of DOCUMENT_STYLE_PROPERTIES) {
      const value = declarations[property];
      if (value && this.content.richTextStyles(`${property}:${value}`)) values[property] = value;
    }
    const originalProperties = DOCUMENT_STYLE_PROPERTIES.filter(
      (property) => declarations[property] && !values[property],
    );
    return { id: root.id, properties: DOCUMENT_STYLE_PROPERTIES, values, originalProperties };
  }

  style(
    document: EditorDocumentData,
    property: DocumentStyleProperty,
    value: string,
  ): EditorDocument {
    this.settings.style(property, value);
    const context = this.styles(document);
    const root = context && this.find(document.nodes, context.id);
    if (!root) throw new Error('UNSUPPORTED_DOCUMENT_ROOT');
    if (value && !this.content.richTextStyles(`${property}:${value}`))
      throw new Error('UNSAFE_DOCUMENT_STYLE');
    const style = value
      ? this.content.setStyle(root.attrs?.style ?? '', property, value)
      : this.content.withoutStyles(root.attrs?.style ?? '', [property]);
    return this.change(document, root.id, { ...root, attrs: { ...root.attrs, style } });
  }

  private ratio(value: string | undefined): number | undefined {
    const parts = value && /^([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)$/.exec(value);
    const width = parts ? this.number(parts[1]) : undefined;
    const height = parts ? this.number(parts[2]) : undefined;
    return width && height ? width / height : undefined;
  }

  private pixels(value: string | undefined): number | undefined {
    return value && /^\d+(?:\.\d+)?px$/.test(value) ? this.number(value.slice(0, -2)) : undefined;
  }
  private number(value: string | undefined): number | undefined {
    if (!value || !/^\d+(?:\.\d+)?$/.test(value)) return undefined;
    return this.settings.safeDimension(Number(value));
  }
  private find(nodes: readonly DocumentNode[], id: string): DocumentNode | undefined {
    return this.all(nodes).find((node) => node.id === id);
  }
  private all(nodes: readonly DocumentNode[]): readonly DocumentNode[] {
    return nodes.flatMap((node) => [node, ...this.all(node.children ?? [])]);
  }
  private change(
    document: EditorDocumentData,
    id: string,
    replacement: DocumentNode,
  ): EditorDocument {
    const replace = (nodes: readonly DocumentNode[]): readonly DocumentNode[] =>
      nodes.map((node) =>
        node.id === id
          ? replacement
          : node.children
            ? { ...node, children: replace(node.children) }
            : node,
      );
    return this.content.document(
      EditorDocument.from(document)
        .withChanges({ nodes: replace(document.nodes) })
        .snapshot(),
    );
  }
}
