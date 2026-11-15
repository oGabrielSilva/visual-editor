/**
 * The keyboard contract of the editor, shared by the shell and by the frame runtime: one table,
 * one matcher. It owns no DOM and no state, so both sides bundle it as it is.
 */
export const EDITOR_SHORTCUT_COMMANDS = [
  'undo',
  'redo',
  'remove',
  'duplicate',
  'moveUp',
  'moveDown',
  'parent',
  'save',
  'insert',
  'menu',
  'selectPrevious',
  'selectNext',
  'selectParent',
  'selectChild',
  'shrinkImage',
  'growImage',
] as const;

/**
 * Commands which only mean something with the keyboard in the piece: bare arrows move the focus
 * in every panel of the shell, and the menu key there belongs to the element which has it.
 */
export const CANVAS_ONLY_SHORTCUTS: ReadonlySet<string> = new Set([
  'menu',
  'selectPrevious',
  'selectNext',
  'selectParent',
  'selectChild',
  'shrinkImage',
  'growImage',
]);

export type EditorShortcutCommand = (typeof EDITOR_SHORTCUT_COMMANDS)[number];

export interface ShortcutKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing?: boolean;
}

export interface EditorShortcut {
  readonly command: EditorShortcutCommand;
  /** Keys as shown to the person; `Mod` stands for Ctrl or Cmd. */
  readonly keys: readonly (readonly string[])[];
}

export const EDITOR_SHORTCUTS: readonly EditorShortcut[] = Object.freeze([
  { command: 'undo', keys: [['Mod', 'Z']] },
  {
    command: 'redo',
    keys: [
      ['Mod', 'Shift', 'Z'],
      ['Mod', 'Y'],
    ],
  },
  { command: 'duplicate', keys: [['Mod', 'D']] },
  { command: 'moveUp', keys: [['Alt', '↑']] },
  { command: 'moveDown', keys: [['Alt', '↓']] },
  { command: 'remove', keys: [['Delete'], ['Backspace']] },
  { command: 'parent', keys: [['Esc']] },
  { command: 'save', keys: [['Mod', 'S']] },
  { command: 'insert', keys: [['Alt', 'Enter']] },
  { command: 'menu', keys: [['Shift', 'F10'], ['Menu']] },
  { command: 'selectPrevious', keys: [['↑']] },
  { command: 'selectNext', keys: [['↓']] },
  { command: 'selectParent', keys: [['←']] },
  { command: 'selectChild', keys: [['→']] },
  { command: 'shrinkImage', keys: [['Shift', 'Alt', '←']] },
  { command: 'growImage', keys: [['Shift', 'Alt', '→']] },
]);

/** Resolves a key press to the command it asks for; text keys never match. */
export function matchEditorShortcut(event: ShortcutKeyEvent): EditorShortcutCommand | undefined {
  if (event.isComposing) return undefined;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const mod = event.ctrlKey || event.metaKey;
  if (mod && !event.altKey) {
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (event.shiftKey) return undefined;
    if (key === 'y') return 'redo';
    if (key === 'd') return 'duplicate';
    if (key === 's') return 'save';
    return undefined;
  }
  if (event.altKey && !mod && !event.shiftKey) {
    if (key === 'ArrowUp') return 'moveUp';
    if (key === 'ArrowDown') return 'moveDown';
    if (key === 'Enter') return 'insert';
    return undefined;
  }
  if (event.altKey && event.shiftKey && !mod) {
    if (key === 'ArrowLeft') return 'shrinkImage';
    if (key === 'ArrowRight') return 'growImage';
    return undefined;
  }
  if (event.shiftKey && !mod && !event.altKey) return key === 'F10' ? 'menu' : undefined;
  if (mod || event.altKey || event.shiftKey) return undefined;
  if (key === 'Delete' || key === 'Backspace') return 'remove';
  if (key === 'Escape') return 'parent';
  if (key === 'ContextMenu') return 'menu';
  if (key === 'ArrowUp') return 'selectPrevious';
  if (key === 'ArrowDown') return 'selectNext';
  if (key === 'ArrowLeft') return 'selectParent';
  if (key === 'ArrowRight') return 'selectChild';
  return undefined;
}
