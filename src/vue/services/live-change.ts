import type { EditorController } from '../controller';

interface OpenSequence {
  readonly key: string;
  readonly documentId: string;
  readonly revision: number;
}

/**
 * Makes a run of changes to one field a single history step. The session has no grouping, so the
 * previous step of the same run is undone before the next value is applied: the history then
 * holds the state before the run and its latest value, and nothing in between. The session stays
 * the only source of truth; no value lives outside it.
 */
export class LiveChangeGroup {
  #open: OpenSequence | undefined;

  constructor(private readonly controller: () => EditorController) {}

  /** Ends the run: the next change of any field is a step of its own. */
  close(): void {
    this.#open = undefined;
  }

  apply(key: string, change: () => boolean): boolean {
    const controller = this.controller();
    const before = controller.state();
    const open = this.#open;
    // Only a step this run created, with nothing after it, may be replaced.
    const continuing =
      open?.key === key &&
      open.documentId === before.document.id &&
      open.revision === before.document.revision &&
      before.canUndo &&
      controller.undo();
    let ok: boolean;
    try {
      ok = change();
    } catch {
      ok = false;
    }
    // A refused value never erases the last accepted one of the run.
    if (!ok && continuing) controller.redo();
    const after = controller.state();
    if (ok || continuing)
      this.#open = { key, documentId: after.document.id, revision: after.document.revision };
    return ok;
  }
}

/** Runs the latest call after a pause; `flush` runs it now, as when a field loses the focus. */
export class Debouncer {
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pending: (() => void) | undefined;

  constructor(private readonly delay = 150) {}

  /** A call is waiting for its pause. */
  get pending(): boolean {
    return !!this.#pending;
  }

  schedule(action: () => void): void {
    this.#pending = action;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.flush(), this.delay);
  }

  flush(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    const action = this.#pending;
    this.#pending = undefined;
    action?.();
  }

  cancel(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#pending = undefined;
  }
}
