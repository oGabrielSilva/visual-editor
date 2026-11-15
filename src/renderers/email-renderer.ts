import type { EditorDocumentData, SourceInput } from '../core/document';
import type { DocumentOutputCodec, DocumentOutputPolicy } from './page-renderer';

export interface MjmlCompilerPort {
  compile(source: string): Promise<string>;
}

/** MJML is for creating supported content; imported HTML is never recompiled. */
export class MjmlEmailRenderer {
  constructor(
    private readonly codec: DocumentOutputCodec,
    private readonly policy: DocumentOutputPolicy,
    private readonly compiler: MjmlCompilerPort,
  ) {}

  render(document: EditorDocumentData): SourceInput {
    if (document.kind !== 'email') throw new Error('renderer.kind_mismatch');
    this.policy.assertSafe(document);
    return this.codec.export(document);
  }

  async createSource(mjml: string): Promise<SourceInput> {
    // Catalog-owned MJML only. The compiler adapter enforces limits and no includes.
    return { html: await this.compiler.compile(mjml), css: '' };
  }
}
