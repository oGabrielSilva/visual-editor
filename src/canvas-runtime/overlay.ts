import type { CanvasBridgeConfiguration, CanvasBridgeTheme } from '../renderers/canvas-bridge';
import { CONTROLS_ATTRIBUTE, isThemeColor, THEME_RADIUS_LIMIT } from '../core/canvas-contract';

const HOST_STYLE =
  'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;display:block!important;visibility:visible!important;';

const SHEET = [
  ':host{all:initial;--ve-accent:#0d9488;--ve-contrast:#fff;--ve-surface:#fff;--ve-text:#18181b;--ve-border:#d4d4d8;--ve-radius:4px}',
  '*{box-sizing:border-box}',
  '[hidden]{display:none!important}',
  '.box{position:fixed;pointer-events:none;border:1px solid var(--ve-accent)}',
  '.box.is-selected{border-color:transparent}',
  '.tag{position:absolute;left:-1px;bottom:100%;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 6px;background:var(--ve-accent);color:var(--ve-contrast);font:11px/1.5 system-ui,sans-serif;border-radius:var(--ve-radius) var(--ve-radius) 0 0}',
  '.tag.is-inside{bottom:auto;top:0;border-radius:0 0 var(--ve-radius) 0}',
  'button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;pointer-events:auto;-webkit-tap-highlight-color:transparent}',
  // The button hangs just below the block, never over the block it belongs to, so a click in
  // the middle of a one-line text still reaches the text.
  '.plus{position:absolute;left:50%;top:100%;width:20px;height:20px;margin:0 0 0 -10px;border-radius:999px;background:var(--ve-accent);color:var(--ve-contrast);box-shadow:0 0 0 2px var(--ve-surface),0 1px 4px #0004}',
  '.plus:focus-visible,.toolbar button:focus-visible,.grip:focus-visible{outline:2px solid var(--ve-accent);outline-offset:1px}',
  '.toolbar{position:fixed;display:flex;flex-wrap:wrap;gap:1px;align-items:center;max-width:calc(100vw - 8px);padding:2px;background:var(--ve-surface);color:var(--ve-text);border:1px solid var(--ve-border);border-radius:var(--ve-radius);box-shadow:0 4px 14px #0003;pointer-events:auto;font:12px/1.3 system-ui,sans-serif}',
  '.toolbar button{min-width:28px;min-height:28px;padding:5px;border-radius:calc(var(--ve-radius)*.75)}',
  '.toolbar button:hover{background:color-mix(in srgb,var(--ve-accent) 16%,transparent)}',
  '.toolbar button.is-danger:hover{background:#dc262622;color:#dc2626}',
  '.toolbar .name{max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 8px 0 6px;font-weight:600;color:var(--ve-accent)}',
  '.toolbar .sep{width:1px;align-self:stretch;margin:4px 2px;background:var(--ve-border)}',
  '.handle{touch-action:none;cursor:grab;user-select:none}',
  '.drop{position:fixed;pointer-events:none;background:var(--ve-accent);border-radius:2px}',
  '.drop.is-inside{background:color-mix(in srgb,var(--ve-accent) 12%,transparent);outline:2px solid var(--ve-accent);outline-offset:-2px}',
  '.drop-label{position:absolute;bottom:100%;left:0;margin-bottom:2px;padding:1px 6px;background:var(--ve-accent);color:var(--ve-contrast);white-space:nowrap;font:11px/1.5 system-ui,sans-serif;border-radius:var(--ve-radius)}',
  '.drop.is-low>.drop-label{bottom:auto;top:100%;margin:2px 0 0}',
  '.embed{position:fixed;display:flex;align-items:center;justify-content:center;gap:6px;overflow:hidden;pointer-events:auto;cursor:pointer;color:var(--ve-text);background:color-mix(in srgb,var(--ve-surface) 88%,var(--ve-accent));border:1px dashed var(--ve-border);font:12px/1.4 system-ui,sans-serif}',
  '.embed-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.grip{position:fixed;width:12px;height:12px;margin:-6px 0 0 -6px;background:var(--ve-surface);border:2px solid var(--ve-accent);border-radius:2px;touch-action:none}',
  '.grip.is-nw,.grip.is-se{cursor:nwse-resize}.grip.is-ne,.grip.is-sw{cursor:nesw-resize}',
  '.variable{position:fixed;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 6px;background:var(--ve-text);color:var(--ve-surface);font:11px/1.5 system-ui,sans-serif;border-radius:var(--ve-radius);pointer-events:none}',
  '.size{position:fixed;padding:1px 6px;background:var(--ve-accent);color:var(--ve-contrast);font:11px/1.5 system-ui,sans-serif;border-radius:var(--ve-radius);pointer-events:none}',
  '@media (pointer:coarse){.toolbar .name{display:none}.toolbar button{min-width:44px;min-height:44px}.plus{width:44px;height:44px;margin:0 0 0 -22px}.grip{width:20px;height:20px;margin:-10px 0 0 -10px}.grip::after{content:"";position:absolute;inset:-12px}}',
].join('');

/** The trusted layer above the piece: a shadow tree which document styles cannot reach. */
export class ControlsOverlay {
  readonly element: HTMLElement;
  readonly shadow: ShadowRoot;
  #sheet: CSSStyleSheet | undefined;

  constructor(private readonly cfg: CanvasBridgeConfiguration) {
    this.element = document.createElement('visual-editor-controls');
    this.element.setAttribute(CONTROLS_ATTRIBUTE, 'true');
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-label', cfg.labels.edit);
    if (cfg.lang) this.element.setAttribute('lang', cfg.lang);
    this.element.style.cssText = HOST_STYLE;
    this.shadow = this.element.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = SHEET;
    this.shadow.append(style);
    this.theme(cfg.theme);
    document.body.append(this.element);
  }

  /** Colors of the host shell; anything which is not a plain color value is ignored. */
  theme(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const theme = value as Partial<Record<keyof CanvasBridgeTheme, unknown>>;
    const names = ['accent', 'contrast', 'surface', 'text', 'border'] as const;
    for (const name of names) {
      const color = theme[name];
      if (isThemeColor(color)) this.element.style.setProperty(`--ve-${name}`, color);
    }
    if (typeof theme.radius === 'number' && theme.radius >= 0 && theme.radius <= THEME_RADIUS_LIMIT)
      this.element.style.setProperty('--ve-radius', `${theme.radius}px`);
    this.#accent();
  }

  /** The selection outline of the piece follows the accent without touching its markup. */
  #accent(): void {
    const accent = this.element.style.getPropertyValue('--ve-accent');
    if (!isThemeColor(accent)) return;
    try {
      this.#sheet ??= new CSSStyleSheet();
      this.#sheet.replaceSync(`:root{--visual-editor-accent:${accent}}`);
      if (!document.adoptedStyleSheets.includes(this.#sheet))
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.#sheet];
    } catch {
      // An engine without constructable sheets keeps the default outline color.
    }
  }

  node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    element.className = className;
    return element;
  }

  /** Icon bodies come exclusively from the installed Lucide subset generated at build time. */
  icon(name: string, size = 16): string | undefined {
    const body = this.cfg.icons?.[name];
    return body
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`
      : undefined;
  }

  button(label: string, icon: string, signal: AbortSignal, action: () => void): HTMLButtonElement {
    const node = document.createElement('button');
    node.type = 'button';
    const svg = this.icon(icon);
    if (svg) node.innerHTML = svg;
    else node.textContent = label;
    node.title = label;
    node.setAttribute('aria-label', label);
    node.addEventListener(
      'click',
      (event) => {
        event.preventDefault();
        action();
      },
      { signal },
    );
    return node;
  }
}
