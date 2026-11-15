import type { CanvasBridgeTheme } from '../../renderers/canvas-bridge';
import { isThemeColor, THEME_RADIUS_LIMIT } from '../../core/canvas-contract';

const TOKENS: Readonly<Record<Exclude<keyof CanvasBridgeTheme, 'radius'>, string>> = {
  accent: 'var(--ui-primary)',
  contrast: 'var(--ui-text-inverted)',
  surface: 'var(--ui-bg)',
  text: 'var(--ui-text)',
  border: 'var(--ui-border-accented)',
};

/**
 * Reads the colors of the host theme as the browser resolved them, for the controls drawn inside
 * the frame of the piece. The frame cannot see the variables of the shell: it receives values.
 */
export class CanvasThemeProbe {
  read(root: HTMLElement): CanvasBridgeTheme | undefined {
    const probe = root.ownerDocument.createElement('span');
    probe.style.cssText =
      'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none';
    root.append(probe);
    const theme: { -readonly [K in keyof CanvasBridgeTheme]: CanvasBridgeTheme[K] } = {};
    try {
      for (const [name, token] of Object.entries(TOKENS) as [keyof typeof TOKENS, string][]) {
        probe.style.color = '';
        probe.style.color = token;
        const value = getComputedStyle(probe).color;
        if (isThemeColor(value)) theme[name] = value;
      }
      probe.style.borderRadius = 'var(--ui-radius)';
      const radius = parseFloat(getComputedStyle(probe).borderTopLeftRadius);
      if (Number.isFinite(radius)) theme.radius = Math.max(0, Math.min(THEME_RADIUS_LIMIT, radius));
    } finally {
      probe.remove();
    }
    return Object.keys(theme).length ? theme : undefined;
  }
}
