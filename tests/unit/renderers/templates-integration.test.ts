import { describe, expect, it } from 'vitest';
import mjml2html from 'mjml';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { ContentPolicy } from '../../../src/security/policy';
import { CompilationGuard, MJML_OPTIONS } from '../../../src/compilation/guard';
import { MjmlEmailRenderer } from '../../../src/renderers/email-renderer';
import { PageRenderer } from '../../../src/renderers/page-renderer';
import { HtmlDocumentAssembler } from '../../../src/renderers/preview-document';
import { TemplateCatalog } from '../../../src/templates/catalog';

describe('complete catalog against real compilation and policy', () => {
  const policy = new ContentPolicy();
  const codec = new HtmlDocumentCodec(policy);
  const guard = new CompilationGuard();
  const email = new MjmlEmailRenderer(codec, policy, {
    compile: async (source) => {
      guard.source(source);
      return guard.output((await mjml2html(source, MJML_OPTIONS)).html);
    },
  });
  const page = new PageRenderer(codec, policy);
  const templates = new TemplateCatalog(email);

  it('creates all six safe portable templates and preserves their CSS, variables and markup', async () => {
    for (const kind of ['email', 'page'] as const) {
      for (const template of templates.list(kind)) {
        const source = await templates.create(template.id);
        const result = codec.import(source, kind);
        expect(
          result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
          template.id,
        ).toEqual([]);
        expect(result.document, template.id).toBeDefined();
        if (!result.document) throw new Error(`INVALID_TEMPLATE:${template.id}`);
        const rendered = (kind === 'email' ? email : page).render(result.document);
        const rebuilt = codec.import(rendered, kind, result.document);
        expect(rebuilt.document?.nodes).toEqual(result.document.nodes);
        expect(new HtmlDocumentAssembler(codec, policy).build(rendered, kind)).toContain('<html');
        if (kind === 'email') expect(rendered.html).toContain('role="presentation"');
        else expect(rendered.css).toContain('@media');
      }
    }
  });

  it('creates every declared block using the same safe real compiler', async () => {
    for (const kind of ['email', 'page'] as const) {
      for (const type of templates.blocks(kind)) {
        const result = codec.import(await templates.createBlock(type, kind), kind);
        expect(
          result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
          `${kind}:${type}`,
        ).toEqual([]);
        expect(result.document, `${kind}:${type}`).toBeDefined();
      }
    }
  });
});
