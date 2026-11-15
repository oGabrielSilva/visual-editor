import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameWindowGuard } from '../../../src/vue/canvas/frame-window';
import { ShortcutService } from '../../../src/vue/services/shortcuts';

describe('FrameWindowGuard: who is in the window after a load', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const guard = () => {
    const asked: string[] = [];
    let lost = 0;
    const instance = new FrameWindowGuard({
      ask: (challenge) => asked.push(challenge),
      lost: () => {
        lost += 1;
      },
    });
    return { instance, asked, lost: () => lost };
  };

  it('asks a fresh question without any secret on every load and stops the host meanwhile', () => {
    const { instance, asked } = guard();
    expect(instance.waiting).toBe(false);
    instance.loaded();
    expect(instance.waiting).toBe(true);
    instance.loaded();
    expect(asked).toHaveLength(2);
    expect(asked[0]).toMatch(/^[a-f0-9]{32}$/);
    expect(asked[1]).not.toBe(asked[0]);
  });

  it('resumes only with the answer to the question which is open', () => {
    const { instance, asked, lost } = guard();
    instance.loaded();
    instance.loaded();
    expect(instance.confirm(undefined)).toBe(false);
    expect(instance.confirm('other')).toBe(false);
    // The answer to the question of an earlier load says nothing about this one.
    expect(instance.confirm(asked[0])).toBe(false);
    expect(instance.waiting).toBe(true);
    expect(instance.confirm(asked[1])).toBe(true);
    expect(instance.waiting).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(lost()).toBe(0);
  });

  it('declares the window lost when nothing answers, once', () => {
    const { instance, lost } = guard();
    instance.loaded();
    vi.advanceTimersByTime(3_499);
    expect(lost()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(lost()).toBe(1);
    expect(instance.waiting).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(lost()).toBe(1);
  });

  it('expects nothing from a window which was replaced', () => {
    const { instance, asked, lost } = guard();
    instance.loaded();
    instance.reset();
    expect(instance.waiting).toBe(false);
    expect(instance.confirm(asked[0])).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(lost()).toBe(0);
  });
});

describe('a key forwarded by the frame of the piece', () => {
  const service = (unsaved: boolean, readOnly = false) => {
    const calls: string[] = [];
    const shortcuts = new ShortcutService({
      readOnly: () => readOnly,
      mode: () => 'visual',
      busy: () => false,
      hasSelection: () => true,
      history: (direction) => calls.push(direction),
      save: () => calls.push('save'),
      unsaved: () => unsaved,
      block: (command) => calls.push(command),
      insert: () => calls.push('insert'),
    });
    return { calls, shortcuts };
  };

  it('saves only when there is something to save', () => {
    const clean = service(false);
    expect(clean.shortcuts.forwarded('save')).toBe(false);
    expect(clean.calls).toEqual([]);
    const dirty = service(true);
    expect(dirty.shortcuts.forwarded('save')).toBe(true);
    expect(dirty.calls).toEqual(['save']);
    const locked = service(true, true);
    locked.shortcuts.forwarded('save');
    expect(locked.calls).toEqual([]);
  });

  it('keeps the save of the shell itself, which the person asked for, unconditional', () => {
    const clean = service(false);
    expect(clean.shortcuts.run('save')).toBe(true);
    expect(clean.calls).toEqual(['save']);
  });
});
