import { parse } from 'parse5';
import type { EditorDocumentData, SourceInput } from '../core/document';
import { alignElements, canonicalElements } from './markup-tree';

interface Span {
  readonly start: number;
  readonly end: number;
}

/**
 * Finds the exact stretch of the exported source which one element occupies. Editing an element
 * as HTML replaces only that stretch: everything else keeps its original bytes, and the result is
 * imported through the ordinary validation like any other source.
 */
export class ElementSourceMap {
  /** The markup of one element as it stands in the source, or undefined when it has none. */
  read(document: EditorDocumentData, source: SourceInput, id: string): string | undefined {
    const span = this.locate(document, source, id);
    return span ? source.html.slice(span.start, span.end) : undefined;
  }

  /** The whole source with one element replaced by `html`. */
  replace(
    document: EditorDocumentData,
    source: SourceInput,
    id: string,
    html: string,
  ): SourceInput | undefined {
    const span = this.locate(document, source, id);
    if (!span) return undefined;
    return {
      html: source.html.slice(0, span.start) + html + source.html.slice(span.end),
      css: source.css,
    };
  }

  private locate(document: EditorDocumentData, source: SourceInput, id: string): Span | undefined {
    const canonical = canonicalElements(document.nodes);
    if (!canonical.some((node) => node.id === id)) return undefined;
    let found: Span | undefined;
    // The source and the document must describe the same elements in the same order.
    const paired = alignElements(parse(source.html, { sourceCodeLocationInfo: true }), canonical, {
      match: (element, node) => {
        if (node.id !== id) return;
        const location = element.sourceCodeLocation;
        if (location) found = { start: location.startOffset, end: location.endOffset };
        return false;
      },
    });
    return paired === undefined ? undefined : found;
  }
}
