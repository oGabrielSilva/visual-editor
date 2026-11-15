import { TEXT_FONT_FAMILIES } from '../security/text-presentation';
import type { EditorLocale } from './locale';
import type { EditorSelectItem } from './components/ui/EditorSelect.vue';

/** Labels the shared font allowlist for all editor typography controls. */
export class EditorFontOptions {
  items(locale: EditorLocale): readonly EditorSelectItem[] {
    const labels: Readonly<Record<string, string>> = {
      'system-ui': 'properties.fontSystem',
      'sans-serif': 'properties.fontSans',
      serif: 'properties.fontSerif',
      monospace: 'properties.fontMonospace',
    };
    return TEXT_FONT_FAMILIES.map((family) => {
      const key = labels[family];
      return { value: family, label: key ? locale.text(key) : family };
    });
  }
}
