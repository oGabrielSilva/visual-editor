import { describe, expect, it } from 'vitest';
import { createEditor } from '../../../src/composition/browser';

describe('canonical inspector CSS values', () => {
  it('uses CSS priority and source order without modifying preserved source', () => {
    const editor = createEditor({
      source: {
        html: '<main><p style="color:red;COLOR : blue; font-family: Georgia, serif; font-size:12px !important;font-size:24px">Original</p></main>',
        css: '',
      },
    });
    const id = editor.controller.canvasRegions().find((region) => region.kind === 'text')!.id;
    editor.controller.select(id);
    const before = editor.session.exportSource();
    expect(editor.controller.style('color')).toBe('blue');
    expect(editor.controller.style('font-size')).toBe('12px');
    expect(editor.controller.style('missing', 'fallback')).toBe('fallback');
    expect(editor.controller.style('constructor', 'fallback')).toBe('fallback');
    expect(editor.controller.inlineStyles(id)['font-family']).toBe('Georgia,serif');
    expect(editor.session.exportSource()).toEqual(before);
    expect(editor.controller.updateStyle('color', 'green')).toBe(true);
    expect(editor.controller.style('color')).toBe('green');
    expect(editor.controller.undo()).toBe(true);
    expect(editor.controller.style('color')).toBe('blue');
    editor.dispose();
  });
  it('reads important duplicate declarations consistently and cannot mutate canonical data through the map', () => {
    const editor = createEditor({
      source: {
        html: '<main><p style="color:red!important;color:blue;color:green!important;color:black">Original</p></main>',
        css: '',
      },
    });
    const id = editor.controller.canvasRegions().find((region) => region.kind === 'text')!.id;
    editor.controller.select(id);
    const map = editor.controller.inlineStyles(id);
    expect(map.color).toBe('green');
    Reflect.set(map, 'color', 'black');
    expect(editor.controller.style('color')).toBe('green');
    editor.session.setReadOnly(true);
    expect(editor.controller.style('color')).toBe('green');
    expect(editor.controller.updateStyle('color', 'black')).toBe(false);
    editor.dispose();
  });
});
