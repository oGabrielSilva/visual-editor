import { ref } from 'vue';
import type { Ref } from 'vue';
import type { RichTextCommandName } from '../../rich-text/commands';
import { emptyRichTextState } from '../../rich-text/commands';
import type { CanvasTextState } from '../../security/preview-message';
import type { EditorController } from '../controller';

/**
 * The owner of the text transaction: the controller of an HTML document, or of a block piece.
 * Both open a text, take its drafts, confirm or cancel it.
 */
export interface InlineTextOwner {
  linkPolicy(): ReturnType<EditorController['linkPolicy']>;
  state(): {
    readonly pendingRichText?: { readonly id: string } | undefined;
    readonly document: { readonly revision: number };
    readonly readOnly: boolean;
  };
  select(id: string): boolean;
  beginRichText(id: string): boolean;
  updateRichTextDraft(html: string): boolean;
  commitRichText(): boolean;
  cancelRichText(): void;
}
import { RemoteRichTextCommands, RichTextCommandValues } from '../rich-text-commands';

/** What the coordinator asks of the preview frame; all of it travels as typed messages. */
export interface InlineTextFrame {
  textCommand(command: RichTextCommandName, value: string | null): void;
  rejectText(nodeId: string, reason: 'begin' | 'draft' | 'commit'): void;
  openText(nodeId: string): void;
  focusText(): void;
  refresh(): void;
}

export interface InlineTextPorts {
  controller(): InlineTextOwner;
  frame(): InlineTextFrame | undefined;
  readOnly(): boolean;
  /** The edition began on a block: the shell follows the selection. */
  selected(id: string): void;
  changed(): void;
  failed(): void;
}

const ANSWER_TIMEOUT = 1_200;

/**
 * The host side of a text edited in its own element inside the frame. The frame holds the latest
 * text; the session holds the transaction. This class keeps both in step: it opens and closes the
 * transaction, hands drafts over and waits for the frame before another command touches the
 * document.
 */
export class InlineTextCoordinator {
  readonly editingId: Ref<string | undefined> = ref();
  readonly fidelity: Ref<number | undefined> = ref();
  readonly remote: RemoteRichTextCommands;
  #waiting:
    | {
        promise: Promise<boolean>;
        resolve: (ok: boolean) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;

  constructor(private readonly ports: InlineTextPorts) {
    this.remote = new RemoteRichTextCommands(
      new RichTextCommandValues(() => ports.controller().linkPolicy()),
      (command, value) => {
        // Leaving the text is decided here as well, so the bar never outlives the edition.
        if (command === 'cancel') this.cancel();
        else if (command === 'finish') void this.flush();
        else ports.frame()?.textCommand(command, value);
      },
    );
  }

  private settle(ok: boolean): void {
    const current = this.#waiting;
    if (!current) return;
    this.#waiting = undefined;
    clearTimeout(current.timer);
    current.resolve(ok);
  }

  private leave(): void {
    this.editingId.value = undefined;
    this.remote.update(undefined);
  }

  private fail(): false {
    this.ports.failed();
    return false;
  }

  /** Without an answer from the frame, the session confirms the last text it received. */
  private confirmOwnCopy(): boolean {
    if (!this.editingId.value) return true;
    try {
      if (!this.ports.controller().commitRichText()) return this.fail();
    } catch {
      return this.fail();
    }
    this.ports.frame()?.textCommand('cancel', null);
    this.leave();
    this.ports.changed();
    return true;
  }

  /**
   * Concludes the edition before another command. The frame holds the latest text, so the host
   * asks it to finish and waits for its commit; the session's own copy is only the fallback.
   */
  flush(): Promise<boolean> {
    if (!this.editingId.value || this.ports.readOnly()) return Promise.resolve(true);
    if (this.#waiting) return this.#waiting.promise;
    let resolve: (ok: boolean) => void = () => undefined;
    const promise = new Promise<boolean>((done) => {
      resolve = done;
    });
    this.#waiting = {
      promise,
      resolve,
      timer: setTimeout(() => this.settle(this.confirmOwnCopy()), ANSWER_TIMEOUT),
    };
    this.ports.frame()?.textCommand('finish', null);
    return promise;
  }

  cancel(): void {
    this.ports.controller().cancelRichText();
    if (this.editingId.value) this.ports.frame()?.textCommand('cancel', null);
    this.leave();
    this.settle(true);
  }

  async begin(id: string): Promise<void> {
    if (this.ports.readOnly() || (this.editingId.value !== id && !(await this.flush()))) return;
    this.ports.frame()?.openText(id);
  }

  /** Text only travels inside the transaction which text-begin opened for that same node. */
  private drafting(id: string): boolean {
    return (
      this.editingId.value === id && this.ports.controller().state().pendingRichText?.id === id
    );
  }

  textBegin(id: string): void {
    const controller = this.ports.controller();
    if (
      this.ports.readOnly() ||
      !(
        controller.state().pendingRichText?.id === id ||
        (controller.select(id) && controller.beginRichText(id))
      )
    ) {
      this.ports.frame()?.rejectText(id, 'begin');
      this.fail();
      return;
    }
    this.editingId.value = id;
    this.fidelity.value = undefined;
    this.remote.update({ ...emptyRichTextState(), ready: true });
    this.ports.selected(id);
  }

  textDraft(value: { nodeId: string; html: string }): void {
    if (this.ports.readOnly() || !this.drafting(value.nodeId)) return;
    if (this.ports.controller().updateRichTextDraft(value.html)) return;
    this.ports.frame()?.rejectText(value.nodeId, 'draft');
    this.fail();
  }

  textCommit(value: { nodeId: string; html: string }): void {
    const controller = this.ports.controller();
    const revision = controller.state().document.revision;
    let committed: boolean;
    try {
      committed =
        !this.ports.readOnly() &&
        this.drafting(value.nodeId) &&
        controller.updateRichTextDraft(value.html) &&
        controller.commitRichText();
    } catch {
      committed = false;
    }
    if (!committed) {
      this.ports.frame()?.rejectText(value.nodeId, 'commit');
      this.fail();
      this.settle(false);
      return;
    }
    this.leave();
    this.ports.changed();
    // The frame waits for a revision; an identical document still has to answer it.
    if (controller.state().document.revision === revision) this.ports.frame()?.refresh();
    this.settle(true);
  }

  textCancel(id: string): void {
    if (this.editingId.value !== id) return;
    const controller = this.ports.controller();
    if (controller.state().pendingRichText?.id === id) controller.cancelRichText();
    this.leave();
    this.settle(true);
  }

  textState(value: { nodeId: string; state: CanvasTextState }): void {
    if (this.editingId.value !== value.nodeId) return;
    this.remote.update({
      ready: true,
      marks: value.state.marks,
      styles: value.state.styles,
      link: value.state.link,
      href: value.state.href,
      empty: value.state.empty,
      canUndo: value.state.canUndo,
      canRedo: value.state.canRedo,
    });
  }

  /** The window was rebuilt: the editor inside it is gone and its text stays with the session. */
  frameReset(): void {
    if (!this.editingId.value) return;
    try {
      if (!this.ports.readOnly()) this.ports.controller().commitRichText();
    } catch {
      // An invalid draft stays pending and visible through the recovery banner.
    }
    this.leave();
    this.settle(true);
  }

  /**
   * The session is the truth: when its transaction ends by any other path (a panel change, a
   * selection, a save), the host leaves the edition and tells the frame to leave it too.
   */
  sessionMoved(pendingId: string | undefined): void {
    if (!this.editingId.value || pendingId === this.editingId.value) return;
    this.ports.frame()?.textCommand('cancel', null);
    this.leave();
    this.settle(true);
  }

  /** Another controller took the editor: the text of the one being left is never dropped. */
  ownerChanged(previous: InlineTextOwner): void {
    if (this.editingId.value) {
      try {
        if (!previous.state().readOnly) previous.commitRichText();
      } catch {
        // A disposed or invalid session keeps what it had.
      }
    }
    this.settle(true);
    this.leave();
    this.fidelity.value = undefined;
  }

  canHistory(direction: 'undo' | 'redo'): boolean {
    return (
      !this.ports.readOnly() &&
      !!this.editingId.value &&
      (direction === 'undo' ? this.remote.state.canUndo : this.remote.state.canRedo)
    );
  }

  history(direction: 'undo' | 'redo'): boolean {
    return this.canHistory(direction) && this.remote.run(direction);
  }

  insertText(value: string): boolean {
    return !this.ports.readOnly() && !!this.editingId.value && this.remote.run('insertText', value);
  }

  dispose(): void {
    this.settle(true);
  }
}
