import type { StorePort } from '../src/application/host';
import type { DocumentKind, EditorDocumentData, SourceInput } from '../src/core/document';

/** Demonstrates a real save/reopen contract without persisting customer data. */
export class MemoryDocumentStore implements StorePort {
  private readonly records = new Map<DocumentKind, EditorDocumentData>();

  async save(
    document: EditorDocumentData,
    _source: SourceInput,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<{ revision: number }> {
    if (signal?.aborted) throw new Error('save.aborted');
    const existing = this.records.get(document.kind);
    if (existing?.id === document.id && existing.revision !== expectedRevision)
      throw new Error('save.conflict');
    this.records.set(document.kind, structuredClone(document));
    return { revision: document.revision };
  }

  load(kind: DocumentKind): EditorDocumentData | undefined {
    const document = this.records.get(kind);
    return document ? structuredClone(document) : undefined;
  }
}
