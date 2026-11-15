import { describe, expect, it } from 'vitest';
import { NodeMjmlCompiler } from '../../src/compilation/node-compiler';
import { TemplateCatalog } from '../../src/templates/catalog';
import { MjmlEmailRenderer } from '../../src/renderers/email-renderer';
import { ContentPolicy } from '../../src/security/policy';
import { HtmlDocumentCodec } from '../../src/codecs/html';
import { CssDocumentCodec } from '../../src/codecs/css';
import { ContentService } from '../../src/application/content-service';
import { DocumentMutationService } from '../../src/application/document-commands';
import { BlockCatalog } from '../../src/core/catalog';

describe('compiled email composition keeps canonical HTML and CSS', () => {
  it('inserts a real MJML block into an existing compiled template', async () => {
    const compiler = new NodeMjmlCompiler(new URL('../../dist/server-worker.js', import.meta.url));
    try {
      const policy = new ContentPolicy();
      const codec = new HtmlDocumentCodec(policy);
      const content = new ContentService(codec, policy, new CssDocumentCodec());
      const templates = new TemplateCatalog(new MjmlEmailRenderer(codec, policy, compiler));
      const imported = codec.import(await templates.create('email-welcome'), 'email');
      expect(imported.document).toBeDefined();
      if (!imported.document) throw new Error('FIXTURE_FAILED');
      const snippet = await templates.createBlock('text', 'email');
      const mutation = new DocumentMutationService(content, new BlockCatalog());
      const next = mutation.insert(imported.document, snippet);
      expect(() => content.export(next.snapshot())).not.toThrow();
      expect(content.export(next.snapshot()).html).toContain('Escreva uma mensagem');
    } finally {
      compiler.dispose();
    }
  }, 35_000);
});
