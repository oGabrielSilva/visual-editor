import type { BlockDocument } from '../core/block-document';
import type { SourceInput } from '../core/document';
import { SecureIdentifier } from '../security/identity';
import type { GeneratedMjmlCompilerPort } from '../compilation/generated-mjml';
import type { OutputMode } from './block-type';
import type { BlockMjmlGenerator } from './email-generator';
import { EmailPreviewMarker } from './email-preview';

/**
 * The HTML of a block e-mail: generated MJML, compiled by the isolated compiler (which checks
 * the output against the e-mail rules), and, for the preview, marked for the canvas.
 */
export class BlockEmailRenderer {
  constructor(
    private readonly generator: BlockMjmlGenerator,
    private readonly compiler: GeneratedMjmlCompilerPort,
    private readonly marker = new EmailPreviewMarker(),
    private readonly identity = new SecureIdentifier(),
  ) {}

  /** A new preview token for every rendering: markup of the author cannot guess it. */
  async render(document: BlockDocument, mode: OutputMode): Promise<SourceInput> {
    const token = this.identity.next();
    const html = await this.compiler.compileGenerated(this.generator.toMjml(document, mode, token));
    return { html: mode === 'preview' ? this.marker.mark(html, document, token) : html, css: '' };
  }
}
