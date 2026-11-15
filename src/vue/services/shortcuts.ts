import {
  CANVAS_ONLY_SHORTCUTS,
  EDITOR_SHORTCUTS,
  matchEditorShortcut,
} from '../../canvas-runtime/shared/shortcuts';
import type { EditorShortcutCommand } from '../../canvas-runtime/shared/shortcuts';

export interface ShortcutPorts {
  readOnly(): boolean;
  mode(): 'visual' | 'html';
  /** A text is being edited in the piece or a gesture is in course: block keys stay out. */
  busy(): boolean;
  hasSelection(): boolean;
  history(direction: 'undo' | 'redo'): void;
  save(): void;
  /** There is a change to save, or a text open in the piece which may hold one. */
  unsaved(): boolean;
  block(command: 'remove' | 'duplicate' | 'moveUp' | 'moveDown' | 'selectParent'): void;
  /** Opens the block picker next to the selected block. */
  insert(): void;
}

export interface ShortcutHelp {
  readonly command: EditorShortcutCommand;
  readonly labelKey: string;
  readonly keys: readonly (readonly string[])[];
}

const LABELS: Readonly<Record<EditorShortcutCommand, string>> = {
  undo: 'actions.undo',
  redo: 'actions.redo',
  duplicate: 'canvas.duplicate',
  moveUp: 'canvas.up',
  moveDown: 'canvas.down',
  remove: 'canvas.remove',
  parent: 'canvas.parent',
  save: 'actions.save',
  insert: 'canvas.add',
  menu: 'canvas.blockMenu',
  selectPrevious: 'canvas.selectPrevious',
  selectNext: 'canvas.selectNext',
  selectParent: 'canvas.parent',
  selectChild: 'canvas.selectChild',
  shrinkImage: 'canvas.shrinkImage',
  growImage: 'canvas.growImage',
};

const LAYERS = '[role="dialog"],[role="menu"],[role="listbox"],[role="alertdialog"]';
const FIELDS =
  'input,textarea,select,[contenteditable=""],[contenteditable="true"],[role="textbox"],[role="combobox"],[role="spinbutton"],[role="slider"],.cm-editor';

/**
 * The shortcuts of the whole shell, in one place. A key pressed in a panel, in a bar or in the
 * piece runs the same command; inside a text field of the shell the field keeps its own keys.
 */
export class ShortcutService {
  constructor(private readonly ports: ShortcutPorts) {}

  list(): readonly ShortcutHelp[] {
    return EDITOR_SHORTCUTS.map((shortcut) => ({
      command: shortcut.command,
      labelKey: LABELS[shortcut.command],
      keys: shortcut.keys,
    }));
  }

  static isTextField(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest(FIELDS);
  }

  /** Handles a key pressed in the shell. Returns whether a command took it. */
  handle(event: KeyboardEvent): boolean {
    if (event.defaultPrevented) return false;
    const command = matchEditorShortcut(event);
    if (!command || CANVAS_ONLY_SHORTCUTS.has(command)) return false;
    const target = event.target;
    if (target instanceof Element && target.closest(LAYERS)) return false;
    if (command !== 'save' && ShortcutService.isTextField(target)) return false;
    if (!this.run(command)) return false;
    event.preventDefault();
    return true;
  }

  /**
   * A key forwarded by the frame of the piece. The frame is not trusted to decide when the host
   * saves: with nothing to save the request is dropped here.
   */
  forwarded(command: EditorShortcutCommand): boolean {
    if (command === 'save' && !this.ports.unsaved()) return false;
    return this.run(command);
  }

  /** Runs a command by name. */
  run(command: EditorShortcutCommand): boolean {
    const ports = this.ports;
    if (command === 'save') {
      if (!ports.readOnly()) ports.save();
      return true;
    }
    if (ports.readOnly()) return false;
    if (command === 'undo' || command === 'redo') {
      ports.history(command);
      return true;
    }
    if (CANVAS_ONLY_SHORTCUTS.has(command)) return false;
    if (ports.mode() !== 'visual' || ports.busy() || !ports.hasSelection()) return false;
    if (command === 'insert') ports.insert();
    else if (command === 'parent') ports.block('selectParent');
    else if (
      command === 'remove' ||
      command === 'duplicate' ||
      command === 'moveUp' ||
      command === 'moveDown'
    )
      ports.block(command);
    else return false;
    return true;
  }
}
