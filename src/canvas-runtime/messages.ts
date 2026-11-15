type Payload = Readonly<Record<string, unknown>>;

const TELEMETRY_INTERVAL = 34;
const DRAFT_INTERVAL = 50;

/**
 * The only way out of the frame: every message carries the window nonce, the revision the frame
 * currently shows and a growing sequence. Measurements are throttled here and keep their last
 * value; what the person asked for is never dropped by this side.
 */
export class BridgeChannel {
  #sequence = 0;
  #disposed = false;
  #pending: (() => void) | undefined;
  readonly #telemetry = new Map<
    string,
    { sent: number; payload?: Payload; timer?: ReturnType<typeof setTimeout> }
  >();
  #draft: { produce: () => Payload | undefined; timer: ReturnType<typeof setTimeout> } | undefined;
  #draftSent = 0;

  constructor(
    private readonly nonce: string,
    public revision: number,
  ) {}

  send(type: string, payload: Payload = {}): void {
    if (this.#disposed) return;
    this.#sequence += 1;
    parent.postMessage(
      { type, nonce: this.nonce, revision: this.revision, sequence: this.#sequence, ...payload },
      '*',
    );
  }

  /** Selection is the one unsequenced intent of the original contract. */
  selection(nodeId: string): void {
    if (this.#disposed) return;
    parent.postMessage(
      { type: 'selection', nonce: this.nonce, revision: this.revision, nodeId },
      '*',
    );
  }

  /** At most thirty per second for each kind; the latest value is always delivered. */
  telemetry(type: string, payload: Payload): void {
    if (this.#disposed) return;
    const entry = this.#telemetry.get(type) ?? { sent: -Infinity };
    this.#telemetry.set(type, entry);
    const elapsed = performance.now() - entry.sent;
    if (elapsed >= TELEMETRY_INTERVAL && !entry.timer) {
      entry.sent = performance.now();
      this.send(type, payload);
      return;
    }
    entry.payload = payload;
    entry.timer ??= setTimeout(
      () => {
        delete entry.timer;
        const latest = entry.payload;
        delete entry.payload;
        entry.sent = performance.now();
        if (latest) this.send(type, latest);
      },
      Math.max(0, TELEMETRY_INTERVAL - elapsed),
    );
  }

  /** Coalesces drafts; the producer runs when the message leaves, so it carries the last text. */
  draft(produce: () => Payload | undefined): void {
    if (this.#disposed) return;
    if (this.#draft) {
      this.#draft.produce = produce;
      return;
    }
    const wait = Math.max(0, DRAFT_INTERVAL - (performance.now() - this.#draftSent));
    this.#draft = { produce, timer: setTimeout(() => this.flushDraft(), wait) };
  }

  flushDraft(): void {
    const draft = this.#draft;
    if (!draft) return;
    clearTimeout(draft.timer);
    this.#draft = undefined;
    this.#draftSent = performance.now();
    const payload = draft.produce();
    if (payload) this.send('text-draft', payload);
  }

  cancelDraft(): void {
    if (this.#draft) clearTimeout(this.#draft.timer);
    this.#draft = undefined;
  }

  /** One intent made while a commit awaits its revision; a newer one replaces it. */
  defer(intent: (() => void) | undefined): void {
    this.#pending = intent;
  }

  takeDeferred(): (() => void) | undefined {
    const intent = this.#pending;
    this.#pending = undefined;
    return intent;
  }

  dispose(): void {
    this.#disposed = true;
    this.cancelDraft();
    this.#pending = undefined;
    for (const entry of this.#telemetry.values()) if (entry.timer) clearTimeout(entry.timer);
    this.#telemetry.clear();
  }
}
