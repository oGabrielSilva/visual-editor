const ZONE = 56;
const FASTEST = 22;

/**
 * Scrolls the frame while a drag rests near its top or bottom edge. It runs on its own clock, so
 * the piece keeps moving when the pointer stands still.
 */
export class AutoScroll {
  #speed = 0;
  #frame = 0;
  #after: (() => void) | undefined;

  /** `after` runs after every scroll step, to find the destination under the same point again. */
  update(y: number, after: () => void): void {
    this.#after = after;
    const top = ZONE - y;
    const bottom = y - (innerHeight - ZONE);
    this.#speed =
      top > 0
        ? -Math.ceil((Math.min(top, ZONE) / ZONE) * FASTEST)
        : bottom > 0
          ? Math.ceil((Math.min(bottom, ZONE) / ZONE) * FASTEST)
          : 0;
    if (this.#speed && !this.#frame) this.#frame = requestAnimationFrame(() => this.#step());
    if (!this.#speed) this.stop();
  }

  #step(): void {
    this.#frame = 0;
    if (!this.#speed) return;
    const before = scrollY;
    scrollBy(0, this.#speed);
    if (scrollY !== before) this.#after?.();
    this.#frame = requestAnimationFrame(() => this.#step());
  }

  stop(): void {
    this.#speed = 0;
    this.#after = undefined;
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }
}
