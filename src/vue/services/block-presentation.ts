import type { CanvasRegion } from '../../core/canvas-layout';
import { CanvasContentLabel } from '../canvas-content-label';

export type BlockCategory = 'structure' | 'text' | 'media' | 'actions' | 'other';

export const BLOCK_CATEGORIES: readonly BlockCategory[] = [
  'structure',
  'text',
  'media',
  'actions',
  'other',
];

const CATEGORY: Readonly<Record<string, BlockCategory>> = {
  section: 'structure',
  columns: 'structure',
  hero: 'structure',
  footer: 'structure',
  heading: 'text',
  text: 'text',
  faq: 'text',
  image: 'media',
  button: 'actions',
  form: 'actions',
};

const ICON: Readonly<Record<string, string>> = {
  section: 'i-lucide-square',
  columns: 'i-lucide-columns-2',
  hero: 'i-lucide-layout-template',
  footer: 'i-lucide-panel-bottom',
  heading: 'i-lucide-heading',
  text: 'i-lucide-pilcrow',
  faq: 'i-lucide-circle-question-mark',
  image: 'i-lucide-image',
  button: 'i-lucide-mouse-pointer-click',
  form: 'i-lucide-text-cursor-input',
  divider: 'i-lucide-minus',
  spacer: 'i-lucide-unfold-vertical',
  html: 'i-lucide-code-xml',
  container: 'i-lucide-square-dashed',
  native: 'i-lucide-code-xml',
  'canvas.column': 'i-lucide-rectangle-vertical',
  'canvas.row': 'i-lucide-rows-2',
};

const FALLBACK_ICON = 'i-lucide-box';

/**
 * How a block is presented to a person: its category in the palette, its icon and the friendly
 * name of what is selected. One table for the palette, the tree, the path and the piece.
 */
export class BlockPresentation {
  private readonly labels = new CanvasContentLabel();

  category(type: string): BlockCategory {
    return CATEGORY[type] ?? 'other';
  }

  icon(type: string): string {
    return ICON[type] ?? FALLBACK_ICON;
  }

  /** Catalog key of the friendly name of a selectable region. */
  regionLabelKey(region: CanvasRegion): string {
    return this.labels.key(region);
  }

  regionIcon(region: CanvasRegion): string {
    const key = this.labels.key(region);
    if (ICON[key]) return ICON[key];
    if (region.node.tag === 'img') return ICON.image!;
    return ICON[region.kind] ?? (region.container ? ICON.container! : ICON.text!);
  }

  static icons(): readonly string[] {
    return [...new Set([...Object.values(ICON), FALLBACK_ICON])];
  }
}
