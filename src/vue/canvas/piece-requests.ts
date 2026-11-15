import type { CanvasBlockAction } from '../../core/canvas-contract';
import type { CanvasBounds } from '../../security/preview-message';
import type { BlockCommandName } from '../services/block-command-definitions';
import type { BlockCommandService } from '../services/block-commands';
import type { ImageRequestService } from '../services/image-requests';

export interface PieceRequestPorts {
  commands: BlockCommandService;
  images: ImageRequestService;
  readOnly(): boolean;
  /** A rectangle of the frame in the coordinates of the page. */
  pageRect(bounds: CanvasBounds): CanvasBounds | undefined;
  /** The image file whose destination the frame has just answered; taken once. */
  takeFile(): File | undefined;
  /** Gives the keyboard back to the selected block in the frame, unless it went elsewhere. */
  returnFocus(origin: Element | null): void;
}

const ACTIONS: Readonly<Record<CanvasBlockAction, BlockCommandName>> = {
  duplicate: 'duplicate',
  remove: 'remove',
  up: 'moveUp',
  down: 'moveDown',
  html: 'editHtml',
  image: 'replaceImage',
};

/**
 * What the frame of the piece asks the shell to open or do for a block: its menu, the block
 * picker, an action of its bar, a file dropped on an image. Every request of the keyboard brings
 * the keyboard back to the piece when the shell is done with it.
 */
export class PieceRequests {
  constructor(private readonly ports: PieceRequestPorts) {}

  /**
   * Gives the keyboard back once the layers of the shell are gone: the primitives put it on
   * their own triggers as they close, a frame or two later.
   */
  private giveBack(): () => void {
    const origin = globalThis.document?.activeElement ?? null;
    return () =>
      requestAnimationFrame(() => requestAnimationFrame(() => this.ports.returnFocus(origin)));
  }

  action(value: { nodeId: string; action: CanvasBlockAction }): void {
    const origin = value.action === 'remove' ? { returnFocus: this.giveBack() } : {};
    void this.ports.commands.run(ACTIONS[value.action], value.nodeId, undefined, origin);
  }

  /** The "+" of a block or Alt + Enter: the picker opens next to the block. */
  insert(value: { nodeId: string; bounds: CanvasBounds; keyboard: boolean }): void {
    // The picker opens at the button which asked for it: the middle of the lower edge.
    const block = this.ports.pageRect(value.bounds);
    const anchor = block && {
      x: block.x + block.width / 2 - 10,
      y: block.y + block.height,
      width: 20,
      height: 20,
    };
    this.ports.commands.requestInsertion(
      {
        targetId: value.nodeId,
        placement: 'after',
        ...(anchor ? { anchor } : {}),
        ...(value.keyboard ? { keyboard: true, returnFocus: this.giveBack() } : {}),
      },
      true,
    );
  }

  /** The menu of a block; asked with the keyboard, its first item takes the keyboard. */
  menu(value: { nodeId: string; x: number; y: number; keyboard: boolean }): void {
    this.ports.commands.openMenu(
      value.nodeId,
      this.ports.pageRect({ x: value.x, y: value.y, width: 1, height: 1 }),
      {
        fromPiece: true,
        ...(value.keyboard ? { keyboard: true, returnFocus: this.giveBack() } : {}),
      },
    );
  }

  /** An image file dropped over an image: the upload of the host replaces that image. */
  imageDrop(nodeId: string): void {
    const file = this.ports.takeFile();
    if (file && !this.ports.readOnly()) void this.ports.images.upload(file, { replace: nodeId });
  }
}
