export class EditorDialogFocus {
  private previous: HTMLElement | undefined;
  private content: HTMLElement | undefined;
  open(event: Event, initialSelector?: string): void {
    this.previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    this.content = event.target instanceof HTMLElement ? event.target : undefined;
    const initial = initialSelector
      ? this.content?.querySelector<HTMLElement>(initialSelector)
      : undefined;
    if (initial) {
      event.preventDefault();
      initial.focus({ preventScroll: true });
    }
  }
  close(event: Event, preferred?: HTMLElement): void {
    const target = preferred ?? this.previous;
    if (!target?.isConnected || !target.getClientRects().length) return;
    const active = document.activeElement;
    event.preventDefault();
    if (
      active &&
      active !== document.body &&
      active !== this.previous &&
      !this.content?.contains(active)
    )
      return;
    target.focus({ preventScroll: true });
  }
}
