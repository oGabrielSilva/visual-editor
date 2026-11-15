import type { CanvasRegion } from '../core/canvas-layout';

/** Names structural selections by their editing role without exposing HTML tags. */
export class CanvasContentLabel {
  key(region: CanvasRegion): string {
    if (region.kind !== 'native' && region.kind !== 'container')
      return region.labelKey ?? `blocks.${region.kind}`;
    if (region.node.tag === 'td' || region.node.tag === 'th') return 'canvas.column';
    if (region.node.tag === 'tr') return 'canvas.row';
    return region.container ? 'blocks.section' : 'properties.content';
  }
}
