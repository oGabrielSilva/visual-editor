import type { CanvasContext } from './context';

interface Deferred {
  readonly desired: { x: number; y: number };
  readonly actualEarly: { x: number; y: number };
}

/** Restores the scroll position the host remembers, also after media which arrives late. */
export class ViewportRestorer {
  #pending: { x: number; y: number } | undefined;
  #deferred: Deferred | undefined;

  constructor(private readonly ctx: CanvasContext) {
    const signal = ctx.signal;
    window.addEventListener(
      'scroll',
      () => {
        const deferred = this.#deferred;
        if (deferred && (scrollX !== deferred.actualEarly.x || scrollY !== deferred.actualEarly.y))
          this.cancelDeferred();
        ctx.schedule();
      },
      { passive: true, capture: true, signal },
    );
    for (const type of ['wheel', 'touchstart', 'pointerdown'] as const)
      window.addEventListener(type, () => this.cancelDeferred(), {
        passive: true,
        capture: true,
        signal,
      });
    window.addEventListener('resize', () => ctx.schedule(), { passive: true, signal });
    window.addEventListener('load', () => this.#settle(), { signal });
    for (const type of ['load', 'error'] as const)
      document.addEventListener(type, () => this.#settle(), { capture: true, signal });
  }

  /** The person acted: a late restoration would now move the piece under their hands. */
  cancelDeferred(): void {
    this.#deferred = undefined;
  }

  request(x: unknown, y: unknown): void {
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0 ||
      x > 1_000_000 ||
      y > 1_000_000
    )
      return;
    this.#pending = { x, y };
    this.#restore();
  }

  #restore(): void {
    const desired = this.#pending;
    if (!desired) return;
    this.#pending = undefined;
    this.cancelDeferred();
    scrollTo(desired.x, desired.y);
    const actualEarly = { x: scrollX, y: scrollY };
    if (this.#pendingMedia() && (desired.x !== actualEarly.x || desired.y !== actualEarly.y))
      this.#deferred = { desired, actualEarly };
    this.ctx.send('viewport-restored', { viewport: actualEarly });
    this.ctx.schedule();
  }

  /** Media may arrive in a window which finished loading: a revision is reconciled in place. */
  #pendingMedia(): boolean {
    return (
      document.readyState !== 'complete' || [...document.images].some((image) => !image.complete)
    );
  }

  #settle(): void {
    const deferred = this.#deferred;
    if (!deferred || this.#pendingMedia()) return;
    this.cancelDeferred();
    if (scrollX !== deferred.actualEarly.x || scrollY !== deferred.actualEarly.y) return;
    scrollTo(deferred.desired.x, deferred.desired.y);
    this.ctx.send('viewport-restored', { viewport: { x: scrollX, y: scrollY } });
    this.ctx.schedule();
  }
}
