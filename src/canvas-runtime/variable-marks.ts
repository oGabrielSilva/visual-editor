import type { CanvasContext } from './context';
import type { ControlsOverlay } from './overlay';

/** A variable of the host as the piece writes it: `{{contact.firstName}}`. */
const TOKEN = /\{\{\s*([a-zA-Z0-9._]{1,200})\s*\}\}/g;
/** The name of the highlight the style sheet of the document paints. */
const HIGHLIGHT = 've-variable';
/** Text nodes read in one pass; a larger piece keeps the marks it already has. */
const NODE_LIMIT = 20_000;

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}
type HighlightConstructor = new (...ranges: Range[]) => unknown;

/**
 * Shows the variables of the piece as tags without touching its text: a highlight of the CSS
 * Highlight API over each `{{key}}` (the DOM, the text being edited and the saved piece stay
 * exactly as they are), and, under the pointer, a label with the friendly name the host gave
 * the variable. A browser without the API keeps the plain text.
 */
export class VariableMarks {
  readonly #labels: ReadonlyMap<string, string>;
  readonly #tag: HTMLElement;
  #ranges: { range: Range; key: string }[] = [];
  #frame = 0;
  #pointer: { x: number; y: number } | undefined;
  #pointerFrame = 0;

  constructor(
    private readonly ctx: CanvasContext,
    overlay: ControlsOverlay,
  ) {
    this.#labels = new Map(Object.entries(ctx.cfg.variables ?? {}));
    this.#tag = overlay.node('div', 'variable');
    this.#tag.hidden = true;
    overlay.shadow.append(this.#tag);
    const registry = this.registry();
    if (!registry || !this.constructorOf()) return;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(
        `::highlight(${HIGHLIGHT}){background-color:rgba(13,148,136,.16);color:#0f766e;text-decoration:underline dotted 1px}`,
      );
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch {
      return;
    }
    const observer = new MutationObserver(() => this.schedule());
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    ctx.signal.addEventListener('abort', () => {
      observer.disconnect();
      cancelAnimationFrame(this.#frame);
      cancelAnimationFrame(this.#pointerFrame);
      registry.delete(HIGHLIGHT);
    });
    document.addEventListener(
      'pointermove',
      (event) => {
        this.#pointer = { x: event.clientX, y: event.clientY };
        if (!this.#pointerFrame)
          this.#pointerFrame = requestAnimationFrame(() => {
            this.#pointerFrame = 0;
            this.hover();
          });
      },
      { signal: ctx.signal, passive: true },
    );
    document.addEventListener('scroll', () => this.hide(), {
      signal: ctx.signal,
      capture: true,
      passive: true,
    });
    this.scan();
  }

  private registry(): HighlightRegistry | undefined {
    const css = (globalThis as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS;
    return css?.highlights;
  }

  private constructorOf(): HighlightConstructor | undefined {
    return (globalThis as unknown as { Highlight?: HighlightConstructor }).Highlight;
  }

  private schedule(): void {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.scan();
    });
  }

  private scan(): void {
    const registry = this.registry();
    const Highlight = this.constructorOf();
    if (!registry || !Highlight) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest('visual-editor-controls,script,style')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const ranges: { range: Range; key: string }[] = [];
    let visited = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (++visited > NODE_LIMIT) return;
      const text = node.nodeValue ?? '';
      if (!text.includes('{{')) continue;
      for (const match of text.matchAll(TOKEN)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        ranges.push({ range, key: match[1] ?? '' });
      }
    }
    this.#ranges = ranges;
    registry.set(HIGHLIGHT, new Highlight(...ranges.map((entry) => entry.range)));
    this.hover();
  }

  /** The label of the variable under the pointer, just above it. */
  private hover(): void {
    const point = this.#pointer;
    if (!point || !this.#ranges.length) return this.hide();
    for (const { range, key } of this.#ranges) {
      for (const rect of range.getClientRects()) {
        if (
          point.x < rect.left ||
          point.x > rect.right ||
          point.y < rect.top ||
          point.y > rect.bottom
        )
          continue;
        this.#tag.textContent = this.#labels.get(key) ?? key;
        this.#tag.style.left = `${Math.max(4, rect.left)}px`;
        this.#tag.style.top = `${Math.max(4, rect.top - 22)}px`;
        this.#tag.hidden = false;
        return;
      }
    }
    this.hide();
  }

  private hide(): void {
    this.#tag.hidden = true;
  }
}
