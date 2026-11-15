/** Closed vocabulary shared by the host controls, the message policy and the frame runtime. */
export const RICH_TEXT_COMMANDS = [
  'bold',
  'italic',
  'underline',
  'strike',
  'superscript',
  'subscript',
  'bulletList',
  'orderedList',
  'color',
  'backgroundColor',
  'fontFamily',
  'fontSize',
  'lineHeight',
  'clearFormatting',
  'setLink',
  'unsetLink',
  'insertText',
  'undo',
  'redo',
  'finish',
  'cancel',
] as const;
export type RichTextCommandName = (typeof RICH_TEXT_COMMANDS)[number];

export const RICH_TEXT_TOGGLES = [
  'bold',
  'italic',
  'underline',
  'strike',
  'superscript',
  'subscript',
  'bulletList',
  'orderedList',
] as const;
export type RichTextToggleName = (typeof RICH_TEXT_TOGGLES)[number];

export const RICH_TEXT_STYLES = [
  'color',
  'backgroundColor',
  'fontFamily',
  'fontSize',
  'lineHeight',
] as const;
export type RichTextStyleName = (typeof RICH_TEXT_STYLES)[number];

/** Commands which carry a value. `null` clears a style; every other command takes none. */
export const RICH_TEXT_VALUE_COMMANDS: readonly RichTextCommandName[] = [
  ...RICH_TEXT_STYLES,
  'setLink',
  'insertText',
];

export const RICH_TEXT_LIMITS = Object.freeze({
  commandValue: 2048,
  insertedText: 1024,
  styleValue: 200,
});

export interface RichTextStyleState {
  readonly value: string;
  readonly own: boolean;
  readonly mixed: boolean;
}

export interface RichTextCommandState {
  /** A caret or selection exists, so commands have a target. */
  readonly ready: boolean;
  readonly marks: readonly RichTextToggleName[];
  readonly styles: Readonly<Record<RichTextStyleName, RichTextStyleState>>;
  readonly link: boolean;
  readonly href: string;
  readonly empty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export function emptyRichTextState(): RichTextCommandState {
  const style = (): RichTextStyleState => ({ value: '', own: false, mixed: false });
  return {
    ready: false,
    marks: [],
    styles: {
      color: style(),
      backgroundColor: style(),
      fontFamily: style(),
      fontSize: style(),
      lineHeight: style(),
    },
    link: false,
    href: '',
    empty: true,
    canUndo: false,
    canRedo: false,
  };
}

/** One command surface for the local panel editor and the editor inside the preview frame. */
export interface RichTextCommands {
  readonly state: RichTextCommandState;
  run(command: RichTextCommandName, value?: string | null): boolean;
}
