import { describe, expect, it } from 'vitest';
import * as server from '../../../src/composition/server';

/** The names a host imports on the server from `@lyads/visual-editor/server`. */
describe('server entry exports for block pieces', () => {
  it('exposes every name the host imports', () => {
    for (const name of [
      'parseAnyDocument',
      'UrlPolicy',
      'ContentPolicy',
      'HtmlDocumentCodec',
      'BlockContentGuard',
      'BlockDefinitionRegistry',
      'BlockMjmlGenerator',
      'BlockPageGenerator',
      'BlockEmailRenderer',
      'BlockToHtmlConversion',
      'NodeMjmlCompiler',
      'createServerBlockToolkit',
    ])
      expect(typeof (server as Record<string, unknown>)[name], name).toBe('function');
    expect(typeof server.NodeMjmlCompiler.prototype.compileGenerated).toBe('function');
  });
});
