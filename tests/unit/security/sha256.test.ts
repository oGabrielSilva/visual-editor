import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Base64 } from '../../../src/security/sha256';
import { CANVAS_RUNTIME_BUNDLE } from '../../../src/renderers/canvas-runtime.generated';

const reference = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('base64');

describe('the digest which authorizes the script of the preview', () => {
  it('matches the platform digest for every padding length and for text beyond ASCII', () => {
    for (let length = 0; length < 200; length++) {
      const text = 'a'.repeat(length);
      expect(sha256Base64(text), String(length)).toBe(reference(text));
    }
    for (const text of ['Título do bloco', '日本語 \u{1f600}  ', CANVAS_RUNTIME_BUNDLE])
      expect(sha256Base64(text)).toBe(reference(text));
  });

  it('digests the whole runtime bundle in a few milliseconds', () => {
    const start = performance.now();
    sha256Base64(CANVAS_RUNTIME_BUNDLE);
    expect(performance.now() - start).toBeLessThan(250);
  });
});
