import type { EditorSession } from '../../application/session';
import { DocumentBudget } from '../../core/budget';
import type { CanvasLayout } from '../../core/canvas-layout';
import { EditorDocument } from '../../core/document';
import type { SourceInput } from '../../core/document';
import type { HtmlAssemblyPort } from '../../renderers/preview-document';
import type { DocumentOutline } from '../outline';
import { DocumentRecovery } from '../recovery';
import type { MutationGuard } from './guard';

/** What leaves and enters the editor as a file: source, document, preview and recovery copy. */
export class DocumentTransfer {
  constructor(
    private readonly session: EditorSession,
    private readonly assembler: HtmlAssemblyPort,
    private readonly layout: CanvasLayout,
    private readonly outline: DocumentOutline,
    private readonly guard: MutationGuard,
  ) {}

  exportSource(): SourceInput {
    this.guard.prepareExport();
    return this.session.exportSource();
  }

  exportHtml(): string {
    return this.assembler.build(this.exportSource(), this.session.getState().document.kind);
  }

  previewHtml(): string {
    const state = this.session.getState();
    return this.assembler.build(state.source, state.document.kind, true);
  }

  exportJson(): string {
    this.guard.prepareExport();
    return JSON.stringify(this.session.getState().document);
  }

  exportRecovery(): string {
    const state = this.session.getState();
    return new DocumentRecovery().encode(state.document, state.draftSource, state.pendingRichText);
  }

  async importFile(file: File): Promise<boolean> {
    if (!this.guard.prepareMutation()) return false;
    const initial = this.session.getState();
    const filename = file.name.toLowerCase();
    const limit = filename.endsWith('.json')
      ? DocumentBudget.limits.jsonBytes
      : filename.endsWith('.css')
        ? DocumentBudget.limits.cssBytes
        : DocumentBudget.limits.sourceBytes;
    if (file.size > limit) throw new Error('feedback.largeFile');
    const source = await file.text();
    if (!this.guard.isCurrent(initial)) return false;
    if (filename.endsWith('.json')) {
      const data: unknown = JSON.parse(source);
      const recovery = new DocumentRecovery().decode(data);
      return recovery ? this.restore(recovery) : this.session.importJson(data);
    }
    if (filename.endsWith('.css'))
      return this.session.importSource({ html: this.session.getState().source.html, css: source });
    return this.session.importSource({ html: source, css: '' });
  }

  importRecovery(value: unknown): boolean {
    if (!this.guard.prepareMutation()) return false;
    const recovery = new DocumentRecovery().decode(value);
    if (!recovery || !this.restore(recovery)) return false;
    const pending = this.session.getState().pendingRichText;
    return pending?.valid && !pending.blocked ? this.session.commitRichText() : true;
  }

  private restore(recovery: NonNullable<ReturnType<DocumentRecovery['decode']>>): boolean {
    const recovered = EditorDocument.from(recovery.document).snapshot();
    const pending = recovery.pendingRichText;
    if (
      pending &&
      (pending.documentId !== recovered.id ||
        pending.baseRevision !== recovered.revision ||
        !this.layout.resolveSelection(recovered, pending.id)?.editable ||
        this.layout.resolveSelection(recovered, pending.id)?.id !== pending.id)
    )
      return false;
    if (!this.session.importJson(recovered)) return false;
    if (pending) {
      this.session.setMode('visual');
      const node = this.layout.resolveSelection(this.session.getState().document, pending.id)?.node;
      const initialHtml = node ? this.outline.richText(node) : undefined;
      return initialHtml !== undefined && this.session.restoreRichTextDraft(pending, initialHtml);
    }
    this.session.setMode('html');
    this.session.setDraftSource(recovery.pendingSource);
    return true;
  }
}
