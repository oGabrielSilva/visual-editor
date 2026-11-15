import type { CanvasContext, FramePoint } from './context';
import { InlineTextEditor } from './text-editor';

export type EditPoint = FramePoint | 'end' | 'keep';

const COMMIT_TIMEOUT = 5_000;

interface ActiveText {
  readonly id: string;
  readonly editor: InlineTextEditor;
  awaiting: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

/** The one text being edited in its own element, from the first caret to the host's answer. */
export class TextSession {
  #current: ActiveText | undefined;
  /** Texts whose look would change under the editor: they select, and are edited elsewhere. */
  readonly #refused = new Set<string>();

  constructor(
    private readonly ctx: CanvasContext,
    private readonly highlight: (id: string) => void,
  ) {}

  get id(): string | undefined {
    return this.#current?.id;
  }
  get active(): boolean {
    return !!this.#current;
  }
  get awaiting(): boolean {
    return !!this.#current?.awaiting;
  }
  get dirty(): boolean {
    return !!this.#current?.editor.dirty;
  }

  contains(target: unknown): boolean {
    return !!this.#current && this.#current.editor.contains(target);
  }

  element(): HTMLElement | undefined {
    return this.#current ? this.ctx.marked.get(this.#current.id) : undefined;
  }

  editable(id: string | undefined): id is string {
    return (
      !this.ctx.readOnly &&
      !!id &&
      this.ctx.regions.get(id)?.editable === true &&
      this.ctx.marked.has(id) &&
      !this.#refused.has(id)
    );
  }

  focus(point: EditPoint): void {
    if (this.#current && !this.#current.awaiting) this.#current.editor.focus(point);
  }

  /** The keyboard belongs to the open text whenever the frame holds it. */
  reclaim(): void {
    const current = this.#current;
    if (
      current &&
      !current.awaiting &&
      !this.ctx.readOnly &&
      !this.contains(document.activeElement)
    )
      current.editor.focus('keep');
  }

  setEditable(): void {
    this.#current?.editor.setEditable(!this.ctx.readOnly && !this.#current.awaiting);
  }

  report(): void {
    const current = this.#current;
    if (!current || this.ctx.disposed) return;
    const state = current.editor.state();
    this.ctx.channel.telemetry('text-state', {
      nodeId: current.id,
      marks: state.marks,
      styles: state.styles,
      link: state.link,
      href: state.href,
      empty: state.empty,
      canUndo: state.canUndo,
      canRedo: state.canRedo,
      rect: current.editor.selectionRect(),
    });
  }

  #settle(current: ActiveText): void {
    if (current.timer) clearTimeout(current.timer);
    delete current.timer;
    current.awaiting = false;
  }

  /** The host refused the commit or never answered: the text stays editable and nothing is lost. */
  resume(id: string): void {
    const current = this.#current;
    if (!current || current.id !== id || !current.awaiting) return;
    this.#settle(current);
    this.ctx.channel.defer(undefined);
    current.editor.setEditable(true);
    this.report();
  }

  /** The host refused to open the transaction: the element returns to what it was. */
  reject(id: string): void {
    const current = this.#current;
    if (!current || current.id !== id) return;
    this.#settle(current);
    this.ctx.channel.cancelDraft();
    this.ctx.channel.defer(undefined);
    current.editor.destroy('restore');
    this.#current = undefined;
    this.ctx.schedule();
  }

  end(mode: 'finish' | 'cancel', then?: () => void): void {
    const current = this.#current;
    if (!current) {
      then?.();
      return;
    }
    // A read-only document keeps the text on screen as it is; nothing is confirmed or dropped.
    if (this.ctx.readOnly) return;
    if (current.awaiting) {
      if (then) this.ctx.channel.defer(then);
      return;
    }
    this.ctx.channel.cancelDraft();
    if (mode === 'cancel' || !current.editor.dirty) {
      const element = this.ctx.textElement(current.id);
      // Only a frame which holds the keyboard keeps it; it never takes it from the host.
      const focused = document.hasFocus() && document.activeElement === element;
      current.editor.destroy('restore');
      this.#current = undefined;
      this.ctx.send('text-cancel', { nodeId: current.id });
      if (focused && !then) element?.focus({ preventScroll: true });
      this.ctx.schedule();
      then?.();
      return;
    }
    current.awaiting = true;
    current.editor.setEditable(false);
    this.ctx.channel.defer(then);
    this.ctx.send('text-commit', { nodeId: current.id, html: current.editor.exportHtml() });
    current.timer = setTimeout(() => this.resume(current.id), COMMIT_TIMEOUT);
  }

  /** No local step is left: the history of the document takes the request. */
  documentHistory(direction: 'undo' | 'redo'): void {
    // Concluding a changed text creates a revision, which would erase the redo being asked for.
    if (direction === 'redo' && this.#current?.editor.dirty) return;
    this.end('finish', () => this.ctx.send('history', { direction }));
  }

  /** With a text open, its own history comes first wherever the key was pressed. */
  history(direction: 'undo' | 'redo'): void {
    if (!this.#current?.editor.history(direction)) this.documentHistory(direction);
  }

  run(command: Parameters<InlineTextEditor['run']>[0], value: string | null): void {
    const current = this.#current;
    if (!current || current.awaiting) return;
    if (command === 'finish' || command === 'cancel') this.end(command);
    else if (command === 'undo' || command === 'redo') this.history(command);
    else current.editor.run(command, value);
    if (this.#current === current) this.report();
  }

  begin(id: string | undefined, point: EditPoint): boolean {
    if (!this.editable(id)) return false;
    if (this.#current?.id === id) {
      this.focus(point);
      return true;
    }
    if (this.#current) {
      this.end('finish', () => {
        if (!this.begin(id, point)) this.ctx.select(id);
      });
      return true;
    }
    const element = this.ctx.textElement(id);
    const region = this.ctx.regions.get(id);
    if (!element || !region) return false;
    const editor = InlineTextEditor.mount(
      element,
      { blocks: region.blocks === true, links: region.links !== false },
      {
        changed: (documentChanged) => {
          const current = this.#current;
          if (!current || current.awaiting) return;
          if (documentChanged)
            this.ctx.channel.draft(() =>
              this.#current === current && !current.awaiting
                ? { nodeId: current.id, html: current.editor.exportHtml() }
                : undefined,
            );
          this.report();
          this.ctx.schedule();
        },
        finish: () => this.end('finish'),
        history: (direction) => this.documentHistory(direction),
        toolbar: () => this.ctx.send('text-toolbar', { nodeId: id }),
      },
    );
    if (!(editor instanceof InlineTextEditor)) {
      this.#refused.add(id);
      this.ctx.send('text-unsupported', { nodeId: id });
      if (this.ctx.cfg.diagnostics) this.ctx.send('text-fidelity', { changed: editor.refused });
      return false;
    }
    this.#current = { id, editor, awaiting: false };
    this.highlight(id);
    this.ctx.send('text-begin', { nodeId: id });
    if (this.ctx.cfg.diagnostics) this.ctx.send('text-fidelity', { changed: 0 });
    editor.focus(point);
    this.report();
    return true;
  }

  /**
   * Another revision arrived. A changed text was confirmed by the host and ends here; a clean one
   * is reported so it can open again over the new markup.
   */
  supersede(): string | undefined {
    const previous = this.#current;
    if (!previous) return undefined;
    const reopen = !previous.awaiting && !previous.editor.dirty ? previous.id : undefined;
    this.#settle(previous);
    this.ctx.channel.cancelDraft();
    previous.editor.destroy('keep');
    this.#current = undefined;
    return reopen;
  }

  forgetRefusals(): void {
    this.#refused.clear();
  }
}
