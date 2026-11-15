import { SecureIdentifier } from '../../security/identity';

export interface FrameWindowPorts {
  /** Posts the question to whatever is in the window. It carries no secret. */
  ask(challenge: string): void;
  /** The window does not hold the runtime the host wrote into it. */
  lost(): void;
}

/** Time the runtime has to answer after a load; it answers as soon as it hears the question. */
const ANSWER_TIMEOUT = 3_000;
/** A busy host may run this timer before the answer already queued behind it. */
const ANSWER_GRACE = 500;

/**
 * Knows whether the window of the frame still holds the runtime the host wrote into it. The
 * object the host calls `contentWindow` stays the same when the frame navigates, so a page which
 * took the window would receive whatever the host posts next. After every load of the frame the
 * host therefore stops posting and asks a question without any secret; only the runtime can
 * answer it with the secret of the protocol. A window which does not answer is lost.
 */
export class FrameWindowGuard {
  readonly #identifiers = new SecureIdentifier();
  #challenge: string | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly ports: FrameWindowPorts) {}

  /** The host may not post, and only the answer to its question is heard. */
  get waiting(): boolean {
    return this.#challenge !== undefined;
  }

  /** A new window was written: nothing is expected from the previous one. */
  reset(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#challenge = undefined;
  }

  /** The frame finished a load, of what the host wrote or of anything else. */
  loaded(): void {
    this.reset();
    const challenge = this.#identifiers.next();
    this.#challenge = challenge;
    this.ports.ask(challenge);
    this.#timer = setTimeout(() => {
      this.#timer = setTimeout(() => {
        if (this.#challenge !== challenge) return;
        this.reset();
        this.ports.lost();
      }, ANSWER_GRACE);
    }, ANSWER_TIMEOUT);
  }

  /** An authenticated `ready`: whether it answers the question which is open. */
  confirm(challenge: string | undefined): boolean {
    if (this.#challenge === undefined || challenge !== this.#challenge) return false;
    this.reset();
    return true;
  }
}
