import { addCollection } from '@iconify/vue';
import { EDITOR_ICON_DATA } from './icon-data';

/** Registers only the installed Lucide symbols used by the standalone UI. */
export class EditorIconRegistry {
  private static registered = false;
  static register(): void {
    if (this.registered) return;
    this.registered = addCollection({
      prefix: 'lucide',
      width: 24,
      height: 24,
      icons: EDITOR_ICON_DATA,
    });
    if (!this.registered) throw new Error('EDITOR_ICON_REGISTRY_INVALID');
  }
}
