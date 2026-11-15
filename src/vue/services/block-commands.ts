import { shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import type { CanvasPlacement } from '../../core/canvas-layout';
import type { SourceInput } from '../../core/document';
import type { EditorController } from '../controller';
import { BLOCK_COMMAND_DEFINITIONS } from './block-command-definitions';
import type { BlockCommandItem, BlockCommandName } from './block-command-definitions';

export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface InsertionRequest {
  readonly targetId: string;
  readonly placement: CanvasPlacement;
  /** Where the request was made, in page coordinates, to open the picker next to it. */
  readonly anchor?: FrameRect;
  /** Asked with the keyboard: the keyboard returns to the piece when the picker closes. */
  readonly keyboard?: boolean;
  /** Gives the keyboard back to where the request was made. */
  readonly returnFocus?: () => void;
}

/** The menu of one block, open at a point of the page. */
export interface BlockMenuRequest {
  readonly targetId: string;
  readonly anchor: FrameRect;
  /** Asked with the keyboard: its first item takes the keyboard. */
  readonly keyboard?: boolean;
  /** Gives the keyboard back to where the menu was asked for, when it is dismissed. */
  readonly returnFocus?: () => void;
}

export interface SourceEdit {
  readonly id: string;
  readonly html: string;
}

/** What the commands need from the shell; none of it is document logic. */
export interface BlockCommandPorts {
  controller(): EditorController;
  /** Concludes a text being edited in the piece; false when it could not be concluded. */
  flush(): Promise<boolean>;
  editText(id: string): void;
  replaceImage(id: string): void;
  elementSource(id: string): string | undefined;
  replaceElementSource(id: string, html: string): SourceInput | undefined;
  notify(outcome: 'applied' | 'copied' | 'invalid'): void;
}

interface Removal {
  readonly owner: EditorController;
  readonly id: string;
  readonly documentId: string;
  readonly revision: number;
  /** Gives the keyboard back to the piece once the block is gone, on the block next to it. */
  readonly returnFocus?: () => void;
}

/** Where a command was asked from, when the keyboard has to come back there afterwards. */
export interface CommandOrigin {
  readonly keyboard?: boolean;
  readonly returnFocus?: () => void;
}

/** A menu or a picker asked by the piece right after one was dismissed is not shown. */
const REOPEN_GUARD = 1_000;

/**
 * The single door for acting on a block. The action bar of the piece, the context menus, the
 * tree, the keyboard and the panel all ask here, so a command means the same thing everywhere.
 * Requests which need an answer from the person (confirm, pick a block, edit the HTML) are
 * exposed as state for the shell to show; the document only changes through the controller.
 */
export class BlockCommandService {
  readonly removal: ShallowRef<Removal | undefined> = shallowRef();
  readonly insertion: ShallowRef<InsertionRequest | undefined> = shallowRef();
  readonly sourceEdit: ShallowRef<SourceEdit | undefined> = shallowRef();
  /** The menu of one block, asked for with the secondary button in the piece. */
  readonly menu: ShallowRef<BlockMenuRequest | undefined> = shallowRef();
  /** A copied block; markup already produced by this document, validated again when pasted. */
  readonly clipboard: ShallowRef<string | undefined> = shallowRef();
  /** Why the last HTML written for an element was refused, as catalog keys. */
  readonly sourceProblems: ShallowRef<readonly string[]> = shallowRef([]);

  #dismissed = -Infinity;

  constructor(
    private readonly ports: BlockCommandPorts,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  /** A menu or the picker was dismissed: what the piece asks next, for a second, is not shown. */
  dismissed(): void {
    this.#dismissed = this.clock();
  }

  /** Whether the piece may open a menu or the picker now. */
  #mayReopen(): boolean {
    return this.clock() - this.#dismissed >= REOPEN_GUARD;
  }

  private state() {
    return this.ports.controller().state();
  }

  /** The commands offered for one block, in menu order, with what is possible right now. */
  items(id: string | undefined): readonly BlockCommandItem[] {
    if (!id) return [];
    const controller = this.ports.controller();
    const region = controller.resolveSelection(id);
    if (!region) return [];
    const readOnly = this.state().readOnly;
    const image = region.node.tag === 'img';
    const enabled: Readonly<Record<BlockCommandName, boolean>> = {
      editText: !readOnly && region.editable && controller.richTextFor(region.id) !== undefined,
      selectParent: !!controller.parentOf(region.id),
      insertBefore: !readOnly,
      insertAfter: !readOnly,
      insertInside: !readOnly && region.container,
      duplicate: !readOnly,
      moveUp: !readOnly,
      moveDown: !readOnly,
      editHtml: !readOnly,
      replaceImage: !readOnly && image,
      copy: true,
      paste: !readOnly && !!this.clipboard.value,
      remove: !readOnly,
    };
    return BLOCK_COMMAND_DEFINITIONS.filter(
      (item) =>
        (item.name !== 'insertInside' || region.container) &&
        (item.name !== 'replaceImage' || image) &&
        (item.name !== 'editText' || region.editable),
    ).map((item) => ({ ...item, enabled: enabled[item.name] }));
  }

  /** Runs a command on a block, by default the selected one. */
  async run(
    name: BlockCommandName,
    target?: string,
    anchor?: FrameRect,
    origin: CommandOrigin = {},
  ): Promise<boolean> {
    const controller = this.ports.controller();
    const id = target ?? this.state().selectedNodeId;
    if (!id || !controller.resolveSelection(id)) return false;
    if (name !== 'copy' && name !== 'selectParent' && this.state().readOnly) return false;
    if (!(await this.ports.flush()) || controller !== this.ports.controller()) return false;
    switch (name) {
      case 'editText':
        this.ports.editText(id);
        return true;
      case 'selectParent': {
        const parent = controller.parentOf(id);
        return !!parent && controller.select(parent);
      }
      case 'insertBefore':
      case 'insertAfter':
      case 'insertInside':
        this.requestInsertion({
          targetId: id,
          placement:
            name === 'insertBefore' ? 'before' : name === 'insertAfter' ? 'after' : 'inside',
          ...(anchor ? { anchor } : {}),
          ...(origin.keyboard ? { keyboard: true } : {}),
          ...(origin.returnFocus ? { returnFocus: origin.returnFocus } : {}),
        });
        return true;
      case 'duplicate':
        return this.apply(() => controller.applyCanvasAction(id, 'duplicate'));
      case 'moveUp':
        return this.apply(() => controller.applyCanvasAction(id, 'up'));
      case 'moveDown':
        return this.apply(() => controller.applyCanvasAction(id, 'down'));
      case 'editHtml': {
        const html = this.ports.elementSource(id);
        if (html === undefined) return this.apply(() => false);
        this.sourceProblems.value = [];
        this.sourceEdit.value = { id, html };
        return true;
      }
      case 'replaceImage':
        this.ports.replaceImage(id);
        return true;
      case 'copy': {
        const html = this.ports.elementSource(id);
        if (html === undefined) return this.apply(() => false);
        this.clipboard.value = html;
        this.ports.notify('copied');
        return true;
      }
      case 'paste': {
        const html = this.clipboard.value;
        return !!html && this.apply(() => controller.insertSource({ html, css: '' }, id, 'after'));
      }
      case 'remove':
        this.removal.value = {
          owner: controller,
          id,
          documentId: this.state().document.id,
          revision: this.state().document.revision,
          ...(origin.returnFocus ? { returnFocus: origin.returnFocus } : {}),
        };
        return true;
    }
  }

  private apply(change: () => boolean): boolean {
    let ok: boolean;
    try {
      ok = change();
    } catch {
      ok = false;
    }
    this.ports.notify(ok ? 'applied' : 'invalid');
    return ok;
  }

  /** Moves a block next to or into another one: the drop of the piece and of the tree. */
  async move(sourceId: string, targetId: string, placement: CanvasPlacement): Promise<boolean> {
    const controller = this.ports.controller();
    if (this.state().readOnly || !(await this.ports.flush())) return false;
    if (controller !== this.ports.controller()) return false;
    return this.apply(() => controller.moveTo(sourceId, targetId, placement));
  }

  /** A resize made with the handles of the image in the piece. */
  async resizeImage(id: string, width: number, height: number): Promise<boolean> {
    const controller = this.ports.controller();
    if (this.state().readOnly || !(await this.ports.flush())) return false;
    if (controller !== this.ports.controller()) return false;
    return this.apply(() => controller.resizeImage(id, width, height));
  }

  /** `fromPiece`: asked by the frame, which is not shown right after a dismissal. */
  openMenu(
    targetId: string,
    anchor: FrameRect | undefined,
    options: Pick<BlockMenuRequest, 'keyboard' | 'returnFocus'> & { fromPiece?: boolean } = {},
  ): void {
    const { fromPiece, ...request } = options;
    if (fromPiece && !this.#mayReopen()) return;
    this.menu.value = anchor ? { targetId, anchor, ...request } : undefined;
  }

  closeMenu(): void {
    this.menu.value = undefined;
  }

  requestInsertion(request: InsertionRequest, fromPiece = false): void {
    if (fromPiece && !this.#mayReopen()) return;
    if (!this.state().readOnly) this.insertion.value = request;
  }

  cancelInsertion(): void {
    this.insertion.value = undefined;
  }

  /**
   * Adds a block of the palette. With a destination it goes exactly there; without one it goes
   * after the selected block, inside it when it is a container, or to the end of the content.
   */
  async insert(
    type: string,
    destination?: Pick<InsertionRequest, 'targetId' | 'placement'> | 'end',
  ): Promise<boolean> {
    const controller = this.ports.controller();
    this.insertion.value = undefined;
    if (this.state().readOnly || !controller.blocks(this.state().document.kind).includes(type))
      return false;
    if (!(await this.ports.flush()) || controller !== this.ports.controller()) return false;
    let ok: boolean;
    try {
      ok =
        destination === 'end'
          ? await controller.appendBlock(type)
          : destination
            ? await controller.addBlock(type, destination.targetId, destination.placement)
            : await controller.addBlock(type);
    } catch {
      ok = false;
    }
    if (controller !== this.ports.controller()) return false;
    this.ports.notify(ok ? 'applied' : 'invalid');
    return ok;
  }

  /** Applies the HTML a person wrote for one element: only that element changes, in one step. */
  async applySource(html: string): Promise<boolean> {
    const edit = this.sourceEdit.value;
    const controller = this.ports.controller();
    if (!edit || this.state().readOnly) return false;
    if (!(await this.ports.flush()) || controller !== this.ports.controller()) return false;
    const source = this.ports.replaceElementSource(edit.id, html);
    const ok = this.apply(() => !!source && controller.replaceSource(source));
    if (ok) {
      this.sourceEdit.value = undefined;
      this.sourceProblems.value = [];
      return true;
    }
    this.sourceProblems.value = [
      ...new Set(controller.state().diagnostics.map((diagnostic) => diagnostic.messageKey)),
    ];
    // A refused source leaves its draft in the session: the document keeps the valid revision.
    controller.discardDraft();
    return false;
  }

  cancelSource(): void {
    this.sourceEdit.value = undefined;
    this.sourceProblems.value = [];
  }

  cancelRemoval(): void {
    this.removal.value = undefined;
  }

  /** Removes the block the person confirmed, unless the document changed meanwhile. */
  async confirmRemoval(): Promise<boolean> {
    const removal = this.removal.value;
    const current = (): boolean => {
      const state = this.state();
      return (
        !!removal &&
        removal.owner === this.ports.controller() &&
        removal.documentId === state.document.id &&
        removal.revision === state.document.revision &&
        !state.readOnly
      );
    };
    if (!removal || !current() || !(await this.ports.flush()) || !current()) return false;
    const neighbour = this.neighbour(removal.owner, removal.id);
    const ok = this.apply(() => removal.owner.applyCanvasAction(removal.id, 'remove'));
    if (ok) {
      this.removal.value = undefined;
      // The selection moves to the block next to the removed one, and the keyboard with it.
      if (neighbour) removal.owner.select(neighbour);
      removal.returnFocus?.();
    }
    return ok;
  }

  /** The block before the one being removed, or the one after it, or the one which held it. */
  private neighbour(controller: EditorController, id: string): string | undefined {
    const region = controller.resolveSelection(id);
    if (!region) return undefined;
    const siblings = controller
      .canvasRegions()
      .filter((candidate) => candidate.parentId === region.parentId);
    const position = siblings.findIndex((candidate) => candidate.id === region.id);
    return (
      siblings[position - 1]?.id ?? siblings[position + 1]?.id ?? controller.parentOf(region.id)
    );
  }

  /** Another revision, document or owner: pending questions no longer describe what is on screen. */
  invalidate(): void {
    this.removal.value = undefined;
    this.insertion.value = undefined;
    this.sourceEdit.value = undefined;
    this.menu.value = undefined;
  }
}
