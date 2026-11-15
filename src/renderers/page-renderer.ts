import type { EditorDocument, EditorDocumentData, SourceInput } from '../core/document';

export interface DocumentOutputCodec {
  export(document: EditorDocumentData): SourceInput;
}

export interface DocumentOutputPolicy {
  /** An `EditorDocument` was validated when it was built; its content is checked again. */
  assertSafe(document: EditorDocumentData | EditorDocument): void;
}

/** Serializes the canonical page rather than rebuilding it from recognized blocks. */
export class PageRenderer {
  constructor(
    private readonly codec: DocumentOutputCodec,
    private readonly policy: DocumentOutputPolicy,
  ) {}

  render(document: EditorDocumentData): SourceInput {
    if (document.kind !== 'page') throw new Error('renderer.kind_mismatch');
    this.policy.assertSafe(document);
    return this.codec.export(document);
  }
}
