import type { BlockDocument } from '../core/block-document';
import { EditorDocument } from '../core/document';
import type { Diagnostic, EditorDocumentData, SourceInput } from '../core/document';
import type { HtmlDocumentCodec } from '../codecs/html';
import type { BlockEmailRenderer } from './email-renderer';
import type { BlockPageGenerator } from './page-generator';

export class BlockConversionError extends Error {
  constructor(readonly diagnostics: readonly Diagnostic[]) {
    super('BLOCK_CONVERSION_FAILED');
    this.name = 'BlockConversionError';
  }
}

/**
 * "Convert to editable HTML": one way only, from a block piece (schema 2) to the HTML document
 * of the editor (schema 1), made of the final output of the generators. Nothing converts back.
 * The new document keeps the id and the title; its revision follows the block piece, so a
 * host saving it over the same record moves forward.
 */
export class BlockToHtmlConversion {
  constructor(
    private readonly codec: HtmlDocumentCodec,
    private readonly email: BlockEmailRenderer,
    private readonly page: BlockPageGenerator,
  ) {}

  async convert(document: BlockDocument): Promise<EditorDocumentData> {
    const source: SourceInput =
      document.kind === 'email'
        ? await this.email.render(document, 'final')
        : this.page.toHtml(document, 'final');
    const imported = this.codec.import(source, document.kind);
    if (!imported.document) throw new BlockConversionError(imported.diagnostics);
    return EditorDocument.from({
      ...imported.document,
      id: document.id,
      title: document.title,
      revision: document.revision + 1,
    }).snapshot();
  }
}
