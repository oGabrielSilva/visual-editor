import type { EditorDocumentData, SourceInput } from '../core/document';

export interface AssetReference {
  readonly id: string;
  readonly url: string;
  readonly alt: string;
}

export interface AssetPort {
  upload(file: File, signal?: AbortSignal): Promise<AssetReference>;
  resolve(id: string, signal?: AbortSignal): Promise<{ url: string; alt: string }>;
}

export interface StorePort {
  save(
    document: EditorDocumentData,
    source: SourceInput,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<{ revision: number }>;
}

export interface SlotsPort {
  resolve(kind: 'form' | 'footer', id: string, signal?: AbortSignal): Promise<string>;
}

export interface HostAdapters {
  assets?: AssetPort;
  store?: StorePort;
  slots?: SlotsPort;
}

export class HostIntegration {
  private saveSequence = 0;
  private active: AbortController | undefined;
  constructor(private readonly adapters: HostAdapters = {}) {}

  async save(
    document: EditorDocumentData,
    source: SourceInput,
    expectedRevision: number,
  ): Promise<number | undefined> {
    if (!this.adapters.store) return undefined;
    this.active?.abort();
    const controller = new AbortController();
    this.active = controller;
    const job = ++this.saveSequence;
    const result = await this.adapters.store.save(
      structuredClone(document),
      { ...source },
      expectedRevision,
      controller.signal,
    );
    return controller.signal.aborted || job !== this.saveSequence ? undefined : result.revision;
  }

  get assets(): AssetPort | undefined {
    return this.adapters.assets;
  }
  get slots(): SlotsPort | undefined {
    return this.adapters.slots;
  }
  dispose(): void {
    this.saveSequence++;
    this.active?.abort();
  }
}
