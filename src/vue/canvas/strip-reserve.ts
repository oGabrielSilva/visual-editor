import { ref } from 'vue';
import type { Ref } from 'vue';

/**
 * The height the formatting strip keeps, at the width it has. Its controls change with the text
 * being edited (blocks, links) and wrap differently in each engine. Were the strip to shrink when
 * an edition ends, the piece under it would jump up between the press and the release of the
 * click which ended it, and that click would land on another element than the one pressed: the
 * engine then sends it to their common ancestor, and the text clicked does not open.
 */
export class StripReserve {
  readonly height: Ref<number> = ref(0);
  #width = 0;
  #observer: ResizeObserver | undefined;

  watch(strip: HTMLElement): void {
    this.dispose();
    const measure = (): void => {
      const content = strip.firstElementChild;
      if (!content) return;
      const width = Math.round(strip.getBoundingClientRect().width);
      const height = Math.ceil(content.getBoundingClientRect().height);
      if (width !== this.#width) {
        this.#width = width;
        this.height.value = height;
      } else if (height > this.height.value) this.height.value = height;
    };
    this.#observer = new ResizeObserver(measure);
    this.#observer.observe(strip);
    if (strip.firstElementChild) this.#observer.observe(strip.firstElementChild);
  }

  dispose(): void {
    this.#observer?.disconnect();
    this.#observer = undefined;
  }
}
