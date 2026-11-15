import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileDrop } from '../../../src/vue/canvas/file-drop';
import type { PaletteFrame } from '../../../src/vue/canvas/palette-drag';

/** The little of an element the gesture needs: events and containment. */
class Area extends EventTarget {
  readonly inside = new Set<object>();
  contains(node: object | null): boolean {
    return !!node && (node === this || this.inside.has(node));
  }
}
class Outside {}

const drag = (type: string, related: object | null = null, files: readonly File[] = []): Event =>
  Object.assign(new Event(type, { cancelable: true }), {
    relatedTarget: related,
    clientX: 10,
    clientY: 10,
    dataTransfer: { types: ['Files'], files },
  });

function setup(enabled = true) {
  const calls: string[] = [];
  const frame: PaletteFrame = {
    getFrameElement: () =>
      ({
        getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 100 }),
      }) as HTMLIFrameElement,
    trackInsertion: (_point, file) => calls.push(file ? 'track:file' : 'track'),
    commitInsertion: (_point, file) => calls.push(file ? 'commit:file' : 'commit'),
    cancelInsertion: () => calls.push('cancel'),
  };
  const area = new Area();
  const drop = new FileDrop({
    frame: () => frame,
    enabled: () => enabled,
    begin: () => calls.push('begin'),
  });
  drop.listen(area as unknown as HTMLElement);
  return { area, drop, calls };
}

describe('FileDrop: a file dragged over one editor of the page', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // The gesture asks whether the pointer went to another node of the same editor.
    vi.stubGlobal('Node', Object);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('belongs to the editor whose area it entered, never to another one on the page', () => {
    const first = setup();
    const second = setup();
    first.area.dispatchEvent(drag('dragenter'));
    expect(first.drop.active.value).toBe(true);
    expect(first.calls).toEqual(['begin']);
    expect(second.drop.active.value).toBe(false);
    expect(second.calls).toEqual([]);
  });

  it('ends when the pointer leaves the editor, not when it moves inside it', () => {
    const { area, drop, calls } = setup();
    const child = {};
    area.inside.add(child);
    area.dispatchEvent(drag('dragenter'));
    area.dispatchEvent(drag('dragleave', child));
    expect(drop.active.value).toBe(true);
    area.dispatchEvent(drag('dragleave', new Outside()));
    expect(drop.active.value).toBe(false);
    expect(calls).toEqual(['begin', 'cancel']);
    area.dispatchEvent(drag('dragenter'));
    area.dispatchEvent(drag('dragleave', null));
    expect(drop.active.value).toBe(false);
  });

  it('stops listening and leaves no timer behind when the editor goes away', () => {
    const { area, drop, calls } = setup();
    const file = new File(['x'], 'foto.png', { type: 'image/png' });
    area.dispatchEvent(drag('dragenter'));
    drop.drop(drag('drop', null, [file]) as DragEvent);
    expect(calls).toEqual(['begin', 'commit:file']);
    expect(vi.getTimerCount()).toBe(1);
    drop.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(drop.take()).toBeUndefined();
    area.dispatchEvent(drag('dragenter'));
    expect(drop.active.value).toBe(false);
  });

  it('forgets a dropped file which the piece did not place in time', () => {
    const { area, drop } = setup();
    const file = new File(['x'], 'foto.png', { type: 'image/png' });
    area.dispatchEvent(drag('dragenter'));
    drop.drop(drag('drop', null, [file]) as DragEvent);
    vi.advanceTimersByTime(499);
    expect(drop.take()).toBe(file);
    area.dispatchEvent(drag('dragenter'));
    drop.drop(drag('drop', null, [file]) as DragEvent);
    vi.advanceTimersByTime(500);
    expect(drop.take()).toBeUndefined();
  });
  it('refuses a file where no upload is declared or the document is read-only', () => {
    const { area, drop, calls } = setup(false);
    const file = new File(['x'], 'foto.png', { type: 'image/png' });
    area.dispatchEvent(drag('dragenter'));
    // The layer rises only to refuse: the piece learns nothing and no destination is asked.
    expect(drop.active.value).toBe(true);
    const over = drag('dragover', null, [file]) as DragEvent;
    drop.over(over);
    expect(over.defaultPrevented).toBe(true);
    const dropped = drag('drop', null, [file]) as DragEvent;
    drop.drop(dropped);
    expect(dropped.defaultPrevented).toBe(true);
    expect(drop.active.value).toBe(false);
    expect(drop.take()).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('raises its layer when the frame reports a file over it, and lowers it without a drag', () => {
    const { area, drop, calls } = setup();
    drop.external();
    expect(drop.active.value).toBe(true);
    expect(calls).toEqual(['begin']);
    vi.advanceTimersByTime(1_500);
    expect(drop.active.value).toBe(false);
    drop.external();
    expect(drop.active.value).toBe(true);
    // A pointer event means no drag of the system is in course.
    area.dispatchEvent(new Event('pointermove'));
    expect(drop.active.value).toBe(false);
  });
});
