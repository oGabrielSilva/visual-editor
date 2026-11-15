import { Editor, Extension, getSchema } from '@tiptap/core';
import type { Mark as ProseMirrorMark } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import {
  RESERVED_ATTRIBUTE_PREFIX as ANNOTATION_PREFIX,
  SELECTED_ATTRIBUTE as SELECTED,
} from '../core/canvas-contract';
import { escapeHtml } from '../core/html-escape';
import { RICH_TEXT_LIMITS } from '../rich-text/commands';
import type {
  RichTextCommandName,
  RichTextCommandState,
  RichTextStyleName,
} from '../rich-text/commands';
import { RichTextCommandExecutor, RichTextStateReader } from '../rich-text/command-executor';
import { RichTextDocumentBuilder } from '../rich-text/document-builder';
import type { RichTextSourceNode } from '../rich-text/document-builder';
import { RichTextProjectionExporter } from '../rich-text/projection-export';
import {
  RICH_TEXT_IMPLICIT_ATTRIBUTE,
  RICH_TEXT_VIEW_ORIGIN_ATTRIBUTE,
  RichTextSchema,
} from '../rich-text/schema';

const NO_BREAK_SPACE = String.fromCharCode(0xa0);
interface AppearanceRun {
  readonly signature: string;
  readonly rect: [number, number, number, number];
}
const TEXT_PROPERTIES = [
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-transform',
] as const;
const BOX_PROPERTIES = [
  'background-color',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
] as const;
const PINNED_PROPERTIES = [
  'line-break',
  'overflow-wrap',
  'word-break',
  '-webkit-line-break',
  '-webkit-nbsp-mode',
] as const;

export interface TextEditorOptions {
  readonly blocks: boolean;
  readonly links: boolean;
}

export interface TextEditorEvents {
  /** The text or the selection changed. */
  changed(documentChanged: boolean): void;
  finish(): void;
  history(direction: 'undo' | 'redo'): void;
  /** The person asked to reach the formatting controls outside the frame. */
  toolbar(): void;
}

export interface TextSelectionRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function source(node: Node): RichTextSourceNode {
  if (node.nodeType === Node.TEXT_NODE) return { type: 'text', text: node.nodeValue ?? '' };
  if (node.nodeType !== Node.ELEMENT_NODE) return { type: 'other' };
  const element = node as Element;
  if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml') return { type: 'other' };
  const attributes: Record<string, string> = {};
  for (const attribute of element.attributes)
    if (!attribute.name.startsWith(ANNOTATION_PREFIX)) attributes[attribute.name] = attribute.value;
  const origin = element.getAttribute(RICH_TEXT_VIEW_ORIGIN_ATTRIBUTE);
  return {
    type: 'element',
    tag: element.localName,
    ...(origin ? { origin } : {}),
    attributes,
    children: [...element.childNodes].map(source),
  };
}

/** Reduces pasted markup to text and the marks of the schema; nothing external survives. */
function reducePaste(html: string, blocks: boolean, links: boolean): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const inline = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub', 'code']);
  const structural = new Set(['p', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  const boundary = new Set([...structural, 'div', 'tr', 'blockquote', 'pre', 'table']);
  const dropped = new Set(['script', 'style', 'template', 'title', 'head', 'meta', 'link']);
  let count = 0;
  const render = (node: Node, depth: number): string => {
    if (++count > 20_000 || depth > 64) return '';
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue ?? '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const element = node as Element;
    const tag = element.localName;
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || dropped.has(tag)) return '';
    const content = [...element.childNodes].map((child) => render(child, depth + 1)).join('');
    if (tag === 'br') return '<br>';
    if (inline.has(tag)) return content ? `<${tag}>${content}</${tag}>` : '';
    if (tag === 'a' && links) {
      const href = element.getAttribute('href') ?? '';
      return /^(?:https?:|mailto:|tel:)/i.test(href) && href.length <= RICH_TEXT_LIMITS.commandValue
        ? `<a href="${escapeHtml(href)}">${content}</a>`
        : content;
    }
    if (blocks && structural.has(tag)) return `<${tag}>${content}</${tag}>`;
    // A single-line target keeps the separation of pasted paragraphs as line breaks.
    return !blocks && boundary.has(tag) && content ? `${content}<br>` : content;
  };
  const output = [...parsed.body.childNodes].map((node) => render(node, 0)).join('');
  return blocks ? output : output.replace(/(?:<br>)+$/, '');
}

/** The rich-text editor mounted over the real element of the piece, with its real CSS. */
export class InlineTextEditor {
  readonly #editor: Editor;
  readonly #exporter: RichTextProjectionExporter;
  readonly #executor: RichTextCommandExecutor;
  readonly #reader = new RichTextStateReader();
  readonly #initial: string;
  readonly #plainSpaces: boolean;
  readonly #children: Node[];
  readonly #attributes: readonly (readonly [string, string])[];
  #destroyed = false;

  private constructor(
    private readonly element: HTMLElement,
    editor: Editor,
    exporter: RichTextProjectionExporter,
    executor: RichTextCommandExecutor,
    children: Node[],
    attributes: readonly (readonly [string, string])[],
  ) {
    this.#editor = editor;
    this.#exporter = exporter;
    this.#executor = executor;
    this.#children = children;
    this.#attributes = attributes;
    this.#plainSpaces = !editor.state.doc.textContent.includes(NO_BREAK_SPACE);
    this.#initial = this.exportHtml();
  }

  /**
   * Returns the editor, or how many parts of the element would look different when it cannot be
   * edited in place faithfully (zero when its markup is simply outside what the editor
   * represents). On a refusal the element is left exactly as it was.
   */
  static mount(
    element: HTMLElement,
    options: TextEditorOptions,
    events: TextEditorEvents,
  ): InlineTextEditor | { readonly refused: number } {
    const kit = new RichTextSchema();
    const executor = new RichTextCommandExecutor(kit.formatting, false);
    let invalid = false;
    const history = (editor: Editor, direction: 'undo' | 'redo'): boolean => {
      if (!(direction === 'undo' ? editor.commands.undo() : editor.commands.redo()))
        events.history(direction);
      return true;
    };
    const keys = Extension.create({
      name: 'canvasTextKeys',
      priority: 1000,
      addKeyboardShortcuts() {
        const toggle = (format: 'bold' | 'italic' | 'underline' | 'strike') => (): boolean => {
          executor.run(this.editor, format);
          return true;
        };
        const finish = (): boolean => {
          events.finish();
          return true;
        };
        return {
          'Mod-b': toggle('bold'),
          'Mod-i': toggle('italic'),
          'Mod-u': toggle('underline'),
          'Mod-Shift-x': toggle('strike'),
          'Mod-z': () => history(this.editor, 'undo'),
          'Mod-Shift-z': () => history(this.editor, 'redo'),
          'Mod-y': () => history(this.editor, 'redo'),
          'Mod-Enter': finish,
          'Alt-F10': () => {
            events.toolbar();
            return true;
          },
          Escape: finish,
          // One line of text, or loose text of a cell: Enter breaks the line and adds no block
          // whose margins the first line never had.
          Enter: () =>
            !options.blocks ||
            this.editor.state.selection.$from.parent.attrs[RICH_TEXT_IMPLICIT_ATTRIBUTE] === true
              ? this.editor.commands.setHardBreak()
              : false,
        };
      },
    });
    const extensions = [
      ...kit.extensions({
        content: options.blocks ? 'block+' : 'inline*',
        links: options.links,
        // The host validates every link before sending it; the session validates again.
        isAllowedUri: (value) => !/^\s*(?:javascript|data|vbscript):/i.test(value),
        fidelity: true,
      }),
      keys,
    ];
    const computed = getComputedStyle(element);
    const content = new RichTextDocumentBuilder().build(
      [...element.childNodes].map(source),
      options.blocks,
      {
        markOrder: Object.keys(getSchema(extensions).marks),
        collapse: !/pre|break-spaces/.test(computed.whiteSpace),
      },
    );
    if (!content) return { refused: 0 };
    let editor: Editor;
    try {
      editor = new Editor({
        element: null,
        injectCSS: false,
        extensions,
        content,
        enableContentCheck: true,
        onContentError: () => {
          invalid = true;
        },
        editorProps: {
          transformPastedHTML: (html: string) => reducePaste(html, options.blocks, options.links),
          handleClick: (_view, _position, event) => {
            if (event.target instanceof Element && event.target.closest('a'))
              event.preventDefault();
            return false;
          },
        },
      });
    } catch {
      return { refused: 0 };
    }
    if (invalid) {
      editor.destroy();
      return { refused: 0 };
    }
    const exporter = new RichTextProjectionExporter(editor.schema);
    kit.applyFidelity(editor.schema);
    // An editable element gets engine rules for breaking lines; keep the ones it had.
    const pinned = PINNED_PROPERTIES.map(
      (property) => [property, computed.getPropertyValue(property)] as const,
    ).filter(([, value]) => value !== '');
    const before = InlineTextEditor.appearance(element);
    const children = [...element.childNodes].map((node) => node.cloneNode(true));
    const attributes = [...element.attributes].map(
      (attribute) => [attribute.name, attribute.value] as const,
    );
    try {
      editor.mount({ mount: element });
    } catch {
      editor.destroy();
      element.replaceChildren(...children);
      return { refused: 0 };
    }
    for (const [property, value] of pinned) element.style.setProperty(property, value, 'important');
    const instance = new InlineTextEditor(
      element,
      editor,
      exporter,
      executor,
      children,
      attributes,
    );
    // Always on: an edition which changes what the person sees does not start.
    const changed = InlineTextEditor.difference(before, InlineTextEditor.appearance(element));
    if (changed) {
      instance.destroy('restore');
      return { refused: changed };
    }
    editor.on('transaction', ({ transaction }) => events.changed(transaction.docChanged));
    return instance;
  }

  /** Every run of text and every decorated box of the element, with what makes it look so. */
  private static appearance(element: HTMLElement): AppearanceRun[] {
    const runs: AppearanceRun[] = [];
    const range = document.createRange();
    const transparent = (value: string): boolean =>
      value === 'transparent' || /^rgba\(.*,\s*0\)$/.test(value);
    const textSignature = (parent: Element): string => {
      const style = getComputedStyle(parent);
      const inherited: string[] = [];
      for (let node: Element | null = parent; node; node = node.parentElement) {
        const own = node === parent ? style : getComputedStyle(node);
        if (own.textDecorationLine !== 'none')
          inherited.push(`${own.textDecorationLine}/${own.textDecorationColor}`);
        if (node !== element && !transparent(own.backgroundColor))
          inherited.push(own.backgroundColor);
        if (node === element) break;
      }
      return [
        ...TEXT_PROPERTIES.map((property) => style.getPropertyValue(property)),
        // Vertical alignment places inline boxes; on a block it only describes a table cell.
        style.display.startsWith('inline') ? style.verticalAlign : '',
        ...inherited,
      ].join('|');
    };
    const push = (signature: string, rect: DOMRect, merge: boolean): void => {
      const previous = runs.at(-1);
      if (
        merge &&
        previous?.signature === signature &&
        Math.abs(previous.rect[1] - rect.top) < 0.5 &&
        Math.abs(previous.rect[3] - rect.bottom) < 0.5 &&
        Math.abs(previous.rect[2] - rect.left) < 0.5
      )
        previous.rect[2] = rect.right;
      else runs.push({ signature, rect: [rect.left, rect.top, rect.right, rect.bottom] });
    };
    const bounds = element.getBoundingClientRect();
    push('root', bounds, false);
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof Element) {
        const style = getComputedStyle(node);
        const box = BOX_PROPERTIES.map((property) => style.getPropertyValue(property));
        const decorated =
          !transparent(box[0] ?? '') || box.slice(1).some((value) => parseFloat(value) > 0);
        if (decorated)
          for (const rect of node.getClientRects()) push(`box|${box.join('|')}`, rect, false);
        continue;
      }
      const parent = node.parentElement;
      if (!parent || !node.nodeValue) continue;
      const signature = textSignature(parent);
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width >= 0.5) push(signature, rect, true);
    }
    return runs;
  }

  private static difference(
    before: readonly AppearanceRun[],
    after: readonly AppearanceRun[],
  ): number {
    let changed = Math.abs(before.length - after.length);
    for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
      const left = before[index]!;
      const right = after[index]!;
      if (
        left.signature !== right.signature ||
        left.rect.some((value, side) => Math.abs(value - right.rect[side]!) > 0.5)
      )
        changed += 1;
    }
    return changed;
  }

  get dirty(): boolean {
    return !this.#destroyed && this.exportHtml() !== this.#initial;
  }

  exportHtml(): string {
    const html = this.#exporter.export(this.#editor.state.doc);
    // The element keeps the white-space of the piece, so the browser types a space next to
    // another space or at the end of a line as a no-break space. Unless the source text already
    // used that character on purpose, what the person typed leaves as ordinary spaces.
    return this.#plainSpaces ? html.replaceAll(NO_BREAK_SPACE, ' ') : html;
  }

  contains(node: unknown): boolean {
    return node instanceof Node && this.element.contains(node);
  }

  setEditable(value: boolean): void {
    if (!this.#destroyed) this.#editor.setEditable(value, false);
  }

  /** Puts the caret where the person clicked; `end` is the keyboard entry. */
  focus(point: { x: number; y: number } | 'end' | 'keep'): void {
    if (this.#destroyed) return;
    const view = this.#editor.view;
    const state = view.state;
    let selection = state.selection;
    if (point === 'end') selection = TextSelection.atEnd(state.doc);
    else if (point !== 'keep') {
      const found = view.posAtCoords({ left: point.x, top: point.y });
      selection = found
        ? TextSelection.near(state.doc.resolve(found.pos))
        : TextSelection.atEnd(state.doc);
    }
    view.focus();
    if (!selection.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(selection));
  }

  run(command: RichTextCommandName, value: string | null): boolean {
    if (this.#destroyed) return false;
    return this.#executor.run(this.#editor, command, value);
  }

  history(direction: 'undo' | 'redo'): boolean {
    if (this.#destroyed) return false;
    return direction === 'undo' ? this.#editor.commands.undo() : this.#editor.commands.redo();
  }

  state(): RichTextCommandState {
    const view = this.#editor.view;
    const computed = (
      _marks: readonly ProseMirrorMark[],
      position: number,
    ): Partial<Record<RichTextStyleName, string>> => {
      let target: Node | null;
      try {
        target = view.domAtPos(Math.min(position + 1, view.state.doc.content.size)).node;
      } catch {
        return {};
      }
      const owner = target instanceof Element ? target : target.parentElement;
      if (!owner || !this.element.contains(owner)) return {};
      const style = getComputedStyle(owner);
      const family = style.fontFamily
        .split(',')[0]
        ?.trim()
        .replace(/^["']|["']$/g, '');
      const background = style.backgroundColor;
      return {
        color: style.color,
        ...(/^rgba\(.*,\s*0\)$|^transparent$/.test(background)
          ? {}
          : { backgroundColor: background }),
        ...(family ? { fontFamily: family } : {}),
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
      };
    };
    return this.#reader.read(this.#editor, true, undefined, computed);
  }

  /** The selection rectangle in viewport coordinates, for the controls outside the frame. */
  selectionRect(): TextSelectionRect {
    const view = this.#editor.view;
    try {
      const { from, to } = view.state.selection;
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      const left = Math.min(start.left, end.left);
      const top = Math.min(start.top, end.top);
      return {
        x: left,
        y: top,
        width: Math.max(start.right, end.right) - left,
        height: Math.max(start.bottom, end.bottom) - top,
      };
    } catch {
      const bounds = this.element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    }
  }

  /**
   * `restore` returns the element to the markup it had before the edition; `keep` leaves the
   * edited rendering in place until the next revision is reconciled over it.
   */
  destroy(mode: 'restore' | 'keep'): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    const rendered =
      mode === 'keep' ? [...this.element.childNodes].map((node) => node.cloneNode(true)) : [];
    const selected = this.element.getAttribute(SELECTED);
    this.#editor.destroy();
    for (const attribute of [...this.element.attributes])
      this.element.removeAttribute(attribute.name);
    for (const [name, value] of this.#attributes) this.element.setAttribute(name, value);
    if (selected === null) this.element.removeAttribute(SELECTED);
    else this.element.setAttribute(SELECTED, selected);
    this.element.replaceChildren(...(mode === 'keep' ? rendered : this.#children));
  }
}
