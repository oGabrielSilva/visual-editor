import { describe, expect, it } from 'vitest';
import { NodeMjmlCompiler } from '../../../src/compilation/node-compiler';
import { CompilationGuard, COMPILE_LIMITS } from '../../../src/compilation/guard';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { ContentPolicy } from '../../../src/security/policy';
import { MjmlEmailRenderer } from '../../../src/renderers/email-renderer';
import { TemplateCatalog } from '../../../src/templates/catalog';

describe('MJML compiler isolation', () => {
  it('does not inherit caller input-type flags into its file worker', async () => {
    const previous = [...process.execArgv];
    process.execArgv.push('--input-type=module');
    const compiler = new NodeMjmlCompiler(
      new URL('../../../dist/server-worker.js', import.meta.url),
    );
    try {
      await expect(
        compiler.compile(
          '<mjml><mj-body><mj-section><mj-column><mj-text>Isolated worker</mj-text></mj-column></mj-section></mj-body></mjml>',
        ),
      ).resolves.toContain('Isolated worker');
    } finally {
      process.execArgv.splice(0, process.execArgv.length, ...previous);
      compiler.dispose();
    }
  }, 20_000);
  it('rejects includes, remote fonts, raw execution content and excessive input', () => {
    const guard = new CompilationGuard();
    for (const tag of ['mj-include', 'mj-font', 'mj-raw', 'script'])
      expect(() => guard.source(`<mjml><${tag} /></mjml>`)).toThrow('COMPILE_FORBIDDEN_TAG');
    expect(() => guard.source('x'.repeat(COMPILE_LIMITS.sourceBytes + 1))).toThrow(
      'COMPILE_SOURCE_LIMIT',
    );
    expect(() => guard.output('<script>bad()</script>')).toThrow('COMPILE_UNSAFE_OUTPUT');
  });

  it('terminates a non-cooperative worker within the configured deadline', async () => {
    const compiler = new NodeMjmlCompiler(
      new URL('../../fixtures/infinite-worker.mjs', import.meta.url),
      100,
    );
    await expect(compiler.compile('<mjml></mjml>')).rejects.toThrow('COMPILE_TIMEOUT');
    compiler.dispose();
    await expect(compiler.compile('<mjml></mjml>')).rejects.toThrow('COMPILER_DISPOSED');
  });

  it('compiles all three real MJML templates and validates their Office markup', async () => {
    const compiler = new NodeMjmlCompiler(
      new URL('../../../dist/server-worker.js', import.meta.url),
    );
    const policy = new ContentPolicy();
    const codec = new HtmlDocumentCodec(policy);
    const templates = new TemplateCatalog(new MjmlEmailRenderer(codec, policy, compiler));
    try {
      for (const template of templates.list('email')) {
        const output = await templates.create(template.id);
        expect(output.html).toContain('OfficeDocumentSettings');
        expect(output.html).not.toContain('fonts.googleapis.com');
        const result = codec.import(output, 'email');
        expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
        expect(result.document).toBeDefined();
      }
    } finally {
      compiler.dispose();
    }
  }, 30_000);
});
