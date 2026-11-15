import { describe, expect, it } from 'vitest';
import { iconLoaded } from '@iconify/vue';
import { EditorIconRegistry } from '../../../src/vue/icons';
import { EDITOR_ICON_DATA } from '../../../src/vue/icon-data';

describe('local editor icon registry', () => {
  it('registers the toolbar and select symbols without loading an entire collection or contacting the API', () => {
    EditorIconRegistry.register();
    EditorIconRegistry.register();
    for (const name of [
      'bold',
      'italic',
      'underline',
      'link',
      'check',
      'x',
      'type',
      'chevron-down',
    ])
      expect(iconLoaded('lucide:' + name)).toBe(true);
    expect(Object.keys(EDITOR_ICON_DATA).length).toBeLessThan(96);
    expect(iconLoaded('lucide:unregistered-editor-symbol')).toBe(false);
  });
});
