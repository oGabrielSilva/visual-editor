import type { GeneratedMjml, GeneratedMjmlCompilerPort } from './generated-mjml';

/** A preview compilation replaced by a newer one before it started. */
export const COMPILE_SUPERSEDED = 'COMPILE_SUPERSEDED';

interface PendingPreview {
  readonly mjml: GeneratedMjml;
  resolve(html: string): void;
  reject(error: unknown): void;
}

const BUSY_RETRIES = 40;
const BUSY_DELAY_MS = 50;

/**
 * Two lanes over one compiler, which runs at most two jobs at a time and refuses a third with
 * `COMPILER_BUSY`. The preview lane has at most one compilation in flight and keeps only the
 * newest one waiting: an older waiting preview is rejected with `COMPILE_SUPERSEDED`, because
 * the frame only shows the newest revision. The final lane (save, conversion) runs one at a time
 * in order, so the preview never takes its place; if a compiler shared with the host is busy with
 * other work, the final job waits and tries again instead of failing.
 */
export class CompileLanes {
  readonly preview: GeneratedMjmlCompilerPort;
  readonly final: GeneratedMjmlCompilerPort;
  #previewRunning = false;
  #previewPending: PendingPreview | undefined;
  #finalTail: Promise<unknown> = Promise.resolve();

  constructor(private readonly compiler: GeneratedMjmlCompilerPort) {
    this.preview = { compileGenerated: (mjml) => this.#queuePreview(mjml) };
    this.final = { compileGenerated: (mjml) => this.#queueFinal(mjml) };
  }

  #queuePreview(mjml: GeneratedMjml): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.#previewPending?.reject(new Error(COMPILE_SUPERSEDED));
      this.#previewPending = { mjml, resolve, reject };
      this.#drainPreview();
    });
  }

  #drainPreview(): void {
    const next = this.#previewPending;
    if (this.#previewRunning || !next) return;
    this.#previewPending = undefined;
    this.#previewRunning = true;
    this.#withRetry(
      () => this.compiler.compileGenerated(next.mjml),
      () => !this.#previewPending,
    )
      .then(next.resolve, next.reject)
      .finally(() => {
        this.#previewRunning = false;
        this.#drainPreview();
      });
  }

  #queueFinal(mjml: GeneratedMjml): Promise<string> {
    const job = this.#finalTail.then(() =>
      this.#withRetry(
        () => this.compiler.compileGenerated(mjml),
        () => true,
      ),
    );
    this.#finalTail = job.catch(() => undefined);
    return job;
  }

  /** Waits and tries again while the compiler is busy with work of another lane or owner. */
  async #withRetry(run: () => Promise<string>, keepTrying: () => boolean): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await run();
      } catch (error: unknown) {
        const busy = error instanceof Error && error.message === 'COMPILER_BUSY';
        if (!busy || attempt >= BUSY_RETRIES) throw error;
        // A newer preview is waiting: this one gives up its turn instead of waiting more.
        if (!keepTrying()) throw new Error(COMPILE_SUPERSEDED, { cause: error });
        await new Promise((resolve) => setTimeout(resolve, BUSY_DELAY_MS));
      }
    }
  }
}
