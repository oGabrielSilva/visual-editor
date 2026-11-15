import { describe, expect, it } from 'vitest';
import {
  CANVAS_ONLY_SHORTCUTS,
  EDITOR_SHORTCUTS,
  EDITOR_SHORTCUT_COMMANDS,
  matchEditorShortcut,
} from '../../../src/canvas-runtime/shared/shortcuts';
import { ShortcutService } from '../../../src/vue/services/shortcuts';
import type { ShortcutPorts } from '../../../src/vue/services/shortcuts';

const key = (
  value: string,
  modifiers: Partial<
    Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing', boolean>
  > = {},
) => ({ key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers });

describe('one keyboard table for the shell and for the frame', () => {
  it('resolves every documented combination to its command', () => {
    expect(matchEditorShortcut(key('z', { ctrlKey: true }))).toBe('undo');
    expect(matchEditorShortcut(key('Z', { metaKey: true, shiftKey: true }))).toBe('redo');
    expect(matchEditorShortcut(key('y', { ctrlKey: true }))).toBe('redo');
    expect(matchEditorShortcut(key('d', { metaKey: true }))).toBe('duplicate');
    expect(matchEditorShortcut(key('s', { ctrlKey: true }))).toBe('save');
    expect(matchEditorShortcut(key('ArrowUp', { altKey: true }))).toBe('moveUp');
    expect(matchEditorShortcut(key('ArrowDown', { altKey: true }))).toBe('moveDown');
    expect(matchEditorShortcut(key('Delete'))).toBe('remove');
    expect(matchEditorShortcut(key('Backspace'))).toBe('remove');
    expect(matchEditorShortcut(key('Escape'))).toBe('parent');
    expect(matchEditorShortcut(key('Enter', { altKey: true }))).toBe('insert');
    expect(matchEditorShortcut(key('F10', { shiftKey: true }))).toBe('menu');
    expect(matchEditorShortcut(key('ContextMenu'))).toBe('menu');
    expect(matchEditorShortcut(key('ArrowUp'))).toBe('selectPrevious');
    expect(matchEditorShortcut(key('ArrowDown'))).toBe('selectNext');
    expect(matchEditorShortcut(key('ArrowLeft'))).toBe('selectParent');
    expect(matchEditorShortcut(key('ArrowRight'))).toBe('selectChild');
    expect(matchEditorShortcut(key('ArrowLeft', { altKey: true, shiftKey: true }))).toBe(
      'shrinkImage',
    );
    expect(matchEditorShortcut(key('ArrowRight', { altKey: true, shiftKey: true }))).toBe(
      'growImage',
    );
    expect(EDITOR_SHORTCUTS.map((entry) => entry.command).sort()).toEqual(
      [...EDITOR_SHORTCUT_COMMANDS].sort(),
    );
  });

  it('leaves text keys, composition and unrelated chords alone', () => {
    expect(matchEditorShortcut(key('a'))).toBeUndefined();
    expect(matchEditorShortcut(key('d'))).toBeUndefined();
    expect(matchEditorShortcut(key('z', { ctrlKey: true, altKey: true }))).toBeUndefined();
    expect(matchEditorShortcut(key('s', { ctrlKey: true, shiftKey: true }))).toBeUndefined();
    expect(matchEditorShortcut(key('Delete', { shiftKey: true }))).toBeUndefined();
    expect(matchEditorShortcut(key('ArrowUp', { ctrlKey: true }))).toBeUndefined();
    expect(matchEditorShortcut(key('ArrowUp', { shiftKey: true }))).toBeUndefined();
    expect(matchEditorShortcut(key('F10'))).toBeUndefined();
    expect(matchEditorShortcut(key('Enter'))).toBeUndefined();
    expect(matchEditorShortcut(key('z', { ctrlKey: true, isComposing: true }))).toBeUndefined();
  });
});

describe('ShortcutService', () => {
  const service = (overrides: Partial<ShortcutPorts> = {}) => {
    const calls: string[] = [];
    const ports: ShortcutPorts = {
      readOnly: () => false,
      mode: () => 'visual',
      busy: () => false,
      hasSelection: () => true,
      history: (direction) => calls.push(`history:${direction}`),
      save: () => calls.push('save'),
      unsaved: () => true,
      block: (command) => calls.push(`block:${command}`),
      insert: () => calls.push('insert'),
      ...overrides,
    };
    return { calls, shortcuts: new ShortcutService(ports) };
  };

  it('routes each command to the one port which implements it', () => {
    const { calls, shortcuts } = service();
    for (const command of EDITOR_SHORTCUT_COMMANDS)
      expect(shortcuts.run(command)).toBe(!CANVAS_ONLY_SHORTCUTS.has(command));
    expect(calls).toEqual([
      'history:undo',
      'history:redo',
      'block:remove',
      'block:duplicate',
      'block:moveUp',
      'block:moveDown',
      'block:selectParent',
      'save',
      'insert',
    ]);
  });

  it('leaves bare arrows and the menu key to the panels of the shell', () => {
    const { calls, shortcuts } = service();
    for (const [value, modifiers] of [
      ['ArrowUp', {}],
      ['ArrowDown', {}],
      ['ArrowLeft', {}],
      ['ArrowRight', {}],
      ['ContextMenu', {}],
      ['F10', { shiftKey: true }],
      ['ArrowLeft', { shiftKey: true, altKey: true }],
      ['ArrowRight', { shiftKey: true, altKey: true }],
    ] as const) {
      let prevented = false;
      const event = {
        ...key(value, modifiers),
        defaultPrevented: false,
        target: null,
        preventDefault: () => {
          prevented = true;
        },
      } as unknown as KeyboardEvent;
      expect(shortcuts.handle(event)).toBe(false);
      expect(prevented).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it('keeps block commands out without a selection, during a text edition and in the HTML mode', () => {
    for (const overrides of [
      { hasSelection: () => false },
      { busy: () => true },
      { mode: () => 'html' as const },
    ]) {
      const { calls, shortcuts } = service(overrides);
      expect(shortcuts.run('remove')).toBe(false);
      expect(shortcuts.run('duplicate')).toBe(false);
      expect(shortcuts.run('parent')).toBe(false);
      expect(shortcuts.run('undo')).toBe(true);
      expect(calls).toEqual(['history:undo']);
    }
  });

  it('changes nothing in a read-only document and still takes the save key from the browser', () => {
    const { calls, shortcuts } = service({ readOnly: () => true });
    expect(shortcuts.run('undo')).toBe(false);
    expect(shortcuts.run('remove')).toBe(false);
    expect(shortcuts.run('save')).toBe(true);
    expect(calls).toEqual([]);
  });

  it('lists every shortcut with a label for the help', () => {
    const { shortcuts } = service();
    const list = shortcuts.list();
    expect(list).toHaveLength(EDITOR_SHORTCUTS.length);
    expect(list.every((entry) => entry.labelKey && entry.keys.length)).toBe(true);
  });
});
