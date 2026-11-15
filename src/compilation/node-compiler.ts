import { Worker } from 'node:worker_threads';
import type { MjmlCompilerPort } from '../renderers/email-renderer';
import { CompilationGuard, COMPILE_LIMITS } from './guard';
import { GeneratedMjml } from './generated-mjml';
import type { CompileRequest, GeneratedMjmlCompilerPort } from './generated-mjml';

export class NodeMjmlCompiler implements MjmlCompilerPort, GeneratedMjmlCompilerPort {
  private readonly guard = new CompilationGuard();
  private readonly jobs = new Set<() => void>();
  private disposed = false;

  constructor(
    private readonly workerUrl: URL,
    private readonly timeoutMs: number = COMPILE_LIMITS.timeoutMs,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > COMPILE_LIMITS.timeoutMs)
      throw new Error('INVALID_COMPILE_TIMEOUT');
  }

  /** MJML from outside: no raw region is accepted. */
  async compile(source: string): Promise<string> {
    return this.run(source);
  }

  /** MJML of the block codec, with the raw regions it generated. */
  async compileGenerated(mjml: GeneratedMjml): Promise<string> {
    if (!(mjml instanceof GeneratedMjml)) throw new Error('INVALID_COMPILE_INPUT');
    return this.run(mjml.source, mjml.fragments);
  }

  private async run(source: string, fragments?: readonly string[]): Promise<string> {
    if (this.disposed) throw new Error('COMPILER_DISPOSED');
    this.guard.source(source, fragments);
    if (this.jobs.size >= COMPILE_LIMITS.parallelJobs) throw new Error('COMPILER_BUSY');
    const request: CompileRequest = fragments ? { source, fragments: [...fragments] } : source;
    return new Promise<string>((resolve, reject) => {
      const worker = new Worker(this.workerUrl, {
        workerData: request,
        execArgv: [],
        resourceLimits: {
          maxOldGenerationSizeMb: 192,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 4,
        },
      });
      const finish = () => {
        clearTimeout(timer);
        void worker.terminate();
        this.jobs.delete(cancel);
      };
      const cancel = () => {
        finish();
        reject(new Error('COMPILER_DISPOSED'));
      };
      const timer = setTimeout(() => {
        finish();
        reject(new Error('COMPILE_TIMEOUT'));
      }, this.timeoutMs);
      this.jobs.add(cancel);
      worker.once('message', (message: unknown) => {
        try {
          if (!message || typeof message !== 'object' || !('html' in message))
            throw new Error('COMPILE_FAILED');
          const html = this.guard.output(message.html);
          finish();
          resolve(html);
        } catch (error) {
          finish();
          reject(error);
        }
      });
      worker.once('error', () => {
        finish();
        reject(new Error('COMPILE_FAILED'));
      });
      worker.once('exit', (code) => {
        if (this.jobs.has(cancel)) {
          finish();
          reject(new Error(`COMPILE_EXIT_${code}`));
        }
      });
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const cancel of [...this.jobs]) cancel();
  }
}
