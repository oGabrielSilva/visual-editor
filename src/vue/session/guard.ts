import type { EditorSession } from '../../application/session';

type ViewState = ReturnType<EditorSession['getState']>;

/** What has to be settled before a command changes or exports the document. */
export class MutationGuard {
  constructor(private readonly session: EditorSession) {}

  /** Concludes the text being edited and the pending source; false when the document is locked. */
  prepareMutation(): boolean {
    if (!this.session.commitRichText()) return false;
    const state = this.session.getState();
    if (state.readOnly) return false;
    if (state.draftSource.html !== state.source.html || state.draftSource.css !== state.source.css)
      return this.session.commitDraft();
    return true;
  }

  prepareExport(): void {
    if (!this.session.commitRichText()) throw new Error('feedback.invalid');
    const state = this.session.getState();
    if (state.draftSource.html === state.source.html && state.draftSource.css === state.source.css)
      return;
    if (!this.session.commitDraft()) throw new Error('feedback.invalid');
  }

  /** Nothing changed since `initial`: the answer to something asynchronous still applies. */
  isCurrent(initial: ViewState): boolean {
    try {
      const current = this.session.getState();
      return (
        !current.readOnly &&
        current.editGeneration === initial.editGeneration &&
        current.document.revision === initial.document.revision &&
        current.mode === initial.mode &&
        current.selectedNodeId === initial.selectedNodeId &&
        current.draftSource.html === initial.draftSource.html &&
        current.draftSource.css === initial.draftSource.css
      );
    } catch {
      return false;
    }
  }
}
