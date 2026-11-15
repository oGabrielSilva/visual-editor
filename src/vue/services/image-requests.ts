import { shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import type { CanvasPlacement } from '../../core/canvas-layout';
import type { DocumentKind, SourceInput } from '../../core/document';
import { escapeHtml } from '../../core/html-escape';
import type { EditorController } from '../controller';

/** What the person chose: a URL the host is responsible for, and optionally its asset id. */
export interface EditorImageChoice {
  /** Identifier of the asset in the host, 1 to 128 of `A-Z a-z 0-9 _ -`. Omit for a plain URL. */
  readonly id?: string;
  readonly url: string;
  readonly alt?: string;
}

export interface EditorImageRequest {
  /** The image being replaced; absent when a new image is being inserted. */
  readonly nodeId?: string;
  readonly kind: DocumentKind;
  readonly current?: { readonly url: string; readonly alt: string };
}

/**
 * The door a host implements to choose images. The editor knows nothing about the library, the
 * upload or the permissions behind it: it asks, waits and applies what comes back. Resolving
 * `undefined` means the person gave up.
 */
export interface EditorImagePicker {
  pickImage(request: EditorImageRequest): Promise<EditorImageChoice | undefined>;
  /** Declares support for files dropped on the piece; without it, drops are ignored. */
  uploadImage?(file: File, request: EditorImageRequest): Promise<EditorImageChoice | undefined>;
}

export interface ImageRequestPorts {
  controller(): EditorController;
  picker(): EditorImagePicker | undefined;
  /** The older contract: the host is told and later calls `controller.attachAsset` itself. */
  legacyRequest(): ((nodeId: string | undefined) => void) | undefined;
  flush(): Promise<boolean>;
  notify(outcome: 'applied' | 'invalid'): void;
  /** The exported source with one element rewritten, for a change which is one history step. */
  replaceElementSource?(id: string, html: string): SourceInput | undefined;
}

export interface ImageDialogState {
  readonly nodeId?: string;
  readonly url: string;
  readonly alt: string;
}

export type ImageDestination =
  | { readonly targetId: string; readonly placement: CanvasPlacement }
  | 'end'
  | undefined;

const ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** A new image never overflows the place it lands in; in an e-mail it is a block of its own. */
const NEW_IMAGE_STYLE: Readonly<Record<DocumentKind, string>> = {
  page: 'max-width:100%;height:auto',
  email: 'display:block;max-width:100%;height:auto;border:0',
};
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * One path for every way of choosing an image: the button of the piece, the double click, the
 * panel, the menu and a dropped file. It prefers the picker of the host, falls back to the older
 * request event and, without either, to the editor's own dialog with a URL.
 */
export class ImageRequestService {
  /** Open while the editor's own dialog is the way to choose. */
  readonly dialog: ShallowRef<ImageDialogState | undefined> = shallowRef();
  readonly busy = shallowRef(false);

  constructor(private readonly ports: ImageRequestPorts) {}

  get acceptsFiles(): boolean {
    return typeof this.ports.picker()?.uploadImage === 'function';
  }

  private request(nodeId: string | undefined): EditorImageRequest {
    const controller = this.ports.controller();
    const state = controller.state();
    const node = nodeId ? controller.resolveSelection(nodeId)?.node : undefined;
    return {
      ...(nodeId ? { nodeId } : {}),
      kind: state.document.kind,
      ...(node?.tag === 'img'
        ? { current: { url: node.attrs?.src ?? '', alt: node.attrs?.alt ?? '' } }
        : {}),
    };
  }

  /** Replaces the image of `nodeId`, or inserts a new one when there is none. */
  async choose(nodeId?: string): Promise<boolean> {
    const controller = this.ports.controller();
    if (controller.state().readOnly || this.busy.value) return false;
    if (!(await this.ports.flush()) || controller !== this.ports.controller()) return false;
    const picker = this.ports.picker();
    if (picker) {
      const request = this.request(nodeId);
      return this.settle(controller, () => picker.pickImage(request), nodeId);
    }
    const legacy = this.ports.legacyRequest();
    if (legacy) {
      legacy(nodeId);
      return true;
    }
    const current = this.request(nodeId).current;
    this.dialog.value = {
      ...(nodeId ? { nodeId } : {}),
      url: current?.url ?? '',
      alt: current?.alt ?? '',
    };
    return true;
  }

  /**
   * A file dropped on the piece goes through the upload the host declared: a new image at
   * `destination`, or, with `{ replace }`, in place of the image dropped on.
   */
  async upload(
    file: File,
    destination: ImageDestination | { readonly replace: string },
  ): Promise<boolean> {
    const controller = this.ports.controller();
    const picker = this.ports.picker();
    const upload = picker?.uploadImage;
    if (
      !picker ||
      !upload ||
      controller.state().readOnly ||
      this.busy.value ||
      !file.type.startsWith('image/') ||
      file.size > MAX_UPLOAD_BYTES
    )
      return false;
    const replace =
      destination && destination !== 'end' && 'replace' in destination
        ? controller.resolveSelection(destination.replace)
        : undefined;
    if (
      destination &&
      destination !== 'end' &&
      'replace' in destination &&
      replace?.node.tag !== 'img'
    )
      return false;
    if (!(await this.ports.flush()) || controller !== this.ports.controller()) return false;
    const request = this.request(replace?.id);
    return replace
      ? this.settle(controller, () => upload.call(picker, file, request), replace.id)
      : this.settle(
          controller,
          () => upload.call(picker, file, request),
          undefined,
          destination as ImageDestination,
        );
  }

  private async settle(
    controller: EditorController,
    ask: () => Promise<EditorImageChoice | undefined>,
    nodeId: string | undefined,
    destination?: ImageDestination,
  ): Promise<boolean> {
    this.busy.value = true;
    const scope = controller.state();
    let choice: EditorImageChoice | undefined;
    try {
      choice = await ask();
    } catch {
      this.busy.value = false;
      this.ports.notify('invalid');
      return false;
    }
    this.busy.value = false;
    if (!choice) return false;
    const now = this.ports.controller() === controller ? controller.state() : undefined;
    // The answer belongs to the document which asked: another one never receives it.
    if (!now || now.document.id !== scope.document.id || now.readOnly) return false;
    return this.apply(choice, nodeId, destination);
  }

  /** Applies a choice through the same validated commands as any other change. */
  apply(choice: EditorImageChoice, nodeId?: string, destination?: ImageDestination): boolean {
    const controller = this.ports.controller();
    const url = typeof choice.url === 'string' ? choice.url.trim() : '';
    const alt = typeof choice.alt === 'string' ? choice.alt.slice(0, 500) : '';
    let ok: boolean;
    try {
      if (!url || !controller.linkPolicy().isSafe(url, 'image')) ok = false;
      // An identifier the host got wrong is refused, never silently treated as a plain URL.
      else if (choice.id !== undefined && !ASSET_ID.test(choice.id)) ok = false;
      else if (choice.id !== undefined) {
        const target =
          destination && destination !== 'end'
            ? controller.resolveSelection(destination.targetId)?.id
            : undefined;
        if (!nodeId && target) controller.select(target);
        ok = controller.attachAsset({ id: choice.id, url, alt }, nodeId);
      } else if (nodeId) ok = this.replaceByUrl(controller, nodeId, url, alt);
      else ok = this.insertByUrl(controller, url, alt, destination);
    } catch {
      ok = false;
    }
    this.ports.notify(ok ? 'applied' : 'invalid');
    if (ok) this.dialog.value = undefined;
    return ok;
  }

  /** A plain URL has no asset behind it: the image is ordinary markup, validated as any other. */
  private insertByUrl(
    controller: EditorController,
    url: string,
    alt: string,
    destination: ImageDestination,
  ): boolean {
    const style = NEW_IMAGE_STYLE[controller.state().document.kind];
    const source = {
      html: `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" style="${style}">`,
      css: '',
    };
    if (destination === 'end') return controller.appendSource(source);
    return destination
      ? controller.insertSource(source, destination.targetId, destination.placement)
      : controller.insertSource(source);
  }

  /** A plain URL has no asset behind it: only the address and the description change. */
  private replaceByUrl(
    controller: EditorController,
    nodeId: string,
    url: string,
    alt: string,
  ): boolean {
    if (!controller.select(nodeId)) return false;
    const node = controller.selected()?.node;
    // An image bound to an asset of the host is only replaced through the host.
    if (
      node?.tag !== 'img' ||
      node.attrs?.['data-host-asset-id'] ||
      node.attrs?.['data-lyads-asset-id']
    )
      return false;
    const src = (node.attrs?.src ?? '') !== url;
    const description = (node.attrs?.alt ?? '') !== alt;
    if (src && description) {
      // Address and description are one choice of the person: one step to undo. The session has
      // no command for two attributes, so the element is rewritten in the source and imported.
      const attributes = Object.entries({ ...node.attrs, src: url, alt })
        .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
        .join('');
      const source = this.ports.replaceElementSource?.(nodeId, `<img${attributes}>`);
      if (source && controller.replaceSource(source)) return true;
    }
    if (src && !controller.updateAttribute('src', url)) return false;
    return !description || controller.updateAttribute('alt', alt);
  }

  cancel(): void {
    this.dialog.value = undefined;
  }
}
