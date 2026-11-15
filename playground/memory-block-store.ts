import type { BlockStorePort } from '../src/application/block-session';
import type { BlockDocumentData } from '../src/core/block-document';
import type { DocumentKind, SourceInput } from '../src/core/document';

/** Keeps saved block pieces, with their output, until the page reloads. */
export class MemoryBlockStore implements BlockStorePort {
  private readonly records = new Map<
    DocumentKind,
    { document: BlockDocumentData; output: SourceInput }
  >();

  async save(
    document: BlockDocumentData,
    output: SourceInput,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<{ revision: number }> {
    if (signal?.aborted) throw new Error('save.aborted');
    const existing = this.records.get(document.kind);
    if (existing?.document.id === document.id && existing.document.revision !== expectedRevision)
      throw new Error('save.conflict');
    this.records.set(document.kind, structuredClone({ document, output }));
    return { revision: document.revision };
  }

  load(kind: DocumentKind): BlockDocumentData | undefined {
    const record = this.records.get(kind);
    return record ? structuredClone(record.document) : undefined;
  }

  output(kind: DocumentKind): SourceInput | undefined {
    const record = this.records.get(kind);
    return record ? { ...record.output } : undefined;
  }
}
