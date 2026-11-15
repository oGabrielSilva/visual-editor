import { CANVAS_ICONS } from './canvas-icons';
import { CANVAS_RUNTIME_BUNDLE } from './canvas-runtime.generated';

export interface CanvasBridgeRegion {
  readonly id: string;
  readonly parentId: string | null;
  readonly editable: boolean;
  readonly container: boolean;
  /** The editable text accepts paragraphs, headings and lists, not only one line of marks. */
  readonly blocks?: boolean;
  /** False where the region is itself a link, which cannot contain another. */
  readonly links?: boolean;
  /** Friendly name of the block, shown next to it: "Título", "Imagem", "Coluna". */
  readonly label?: string;
  /** The region is an image: it can be replaced and resized in the piece. */
  readonly media?: 'image';
}

export interface CanvasBridgeLabels {
  readonly edit: string;
  readonly move: string;
  readonly up: string;
  readonly down: string;
  readonly duplicate: string;
  readonly remove: string;
  readonly before: string;
  readonly after: string;
  readonly inside: string;
  readonly parent: string;
  /** "Edit as HTML"; absent where the piece has no HTML of its own (a block piece). */
  readonly html?: string;
  readonly image: string;
  readonly add: string;
  readonly resize: string;
  /** Name of the grip which takes the keyboard, with the keys which change the size. */
  readonly resizeHint: string;
  /** Shown over an image while a dropped file would replace it. */
  readonly replace: string;
  /** Name shown over embedded content, which never loads inside the editor. */
  readonly embed: string;
}

/** Colors of the host shell for the controls drawn over the piece; plain CSS color values. */
export interface CanvasBridgeTheme {
  readonly accent?: string;
  readonly contrast?: string;
  readonly surface?: string;
  readonly text?: string;
  readonly border?: string;
  /** Corner radius in pixels. */
  readonly radius?: number;
}

export interface CanvasBridgeConfiguration {
  readonly nonce: string;
  readonly revision: number;
  readonly regions: readonly CanvasBridgeRegion[];
  readonly readOnly: boolean;
  readonly labels: CanvasBridgeLabels;
  readonly theme?: CanvasBridgeTheme;
  readonly lang?: string;
  /** Allowlisted font names the runtime may report for the selected block. */
  readonly fonts?: readonly string[];
  readonly icons?: Readonly<Record<string, string>>;
  /** Test mode: the runtime reports whether mounting the text editor changed any appearance. */
  readonly diagnostics?: boolean;
  /**
   * False where the host has no block menu (a block piece): the secondary button and the menu
   * key keep what the browser does instead of asking for a menu nobody opens.
   */
  readonly menu?: false;
  /** Friendly names of the variables of the host by key, shown over each `{{key}}`. */
  readonly variables?: Readonly<Record<string, string>>;
}

/**
 * Produces the single script of the preview: the runtime bundle built from src/canvas-runtime
 * followed by its configuration. Imported content never contributes executable code.
 */
export class CanvasBridgeScript {
  source(configuration: CanvasBridgeConfiguration): string {
    const encoded = JSON.stringify({ ...configuration, icons: CANVAS_ICONS })
      .replaceAll('<', '\\u003c')
      .replaceAll(' ', '\\u2028')
      .replaceAll(' ', '\\u2029');
    return `${CANVAS_RUNTIME_BUNDLE};__lyadsCanvas(${encoded});`;
  }
}
