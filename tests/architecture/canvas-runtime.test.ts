import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CanvasBridgeScript } from '../../src/renderers/canvas-bridge';
import {
  CANVAS_RUNTIME_BUNDLE,
  CANVAS_RUNTIME_HASH,
  CANVAS_RUNTIME_SOURCES,
} from '../../src/renderers/canvas-runtime.generated';

const root = fileURLToPath(new URL('../../', import.meta.url));

function sources(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(`${directory}/${entry.name}`)
      : entry.name.endsWith('.ts')
        ? [`${directory}/${entry.name}`]
        : [],
  );
}

describe('the preview runtime is a generated, self-contained bundle', () => {
  it('is regenerated whenever one of its sources changes (yarn runtime)', () => {
    const hash = createHash('sha256');
    for (const path of CANVAS_RUNTIME_SOURCES) {
      hash.update(path);
      hash.update('\n');
      hash.update(readFileSync(join(root, path), 'utf8').split('\r\n').join('\n'));
      hash.update('\n');
    }
    expect(hash.digest('hex')).toBe(CANVAS_RUNTIME_HASH);
    // Every module of the runtime folder is part of the bundle whose hash was checked.
    for (const path of sources('src/canvas-runtime'))
      expect(CANVAS_RUNTIME_SOURCES).toContain(path);
  });

  it('cannot close or escape the inline script which carries it', () => {
    expect(CANVAS_RUNTIME_BUNDLE.length).toBeGreaterThan(10_000);
    expect(CANVAS_RUNTIME_BUNDLE).not.toMatch(/<\/script/i);
    expect(CANVAS_RUNTIME_BUNDLE).not.toContain('<!--');
    expect(CANVAS_RUNTIME_BUNDLE).not.toMatch(/[\u2028\u2029]/);
  });

  it('has no Vue, no host module and no dynamic code in the frame', () => {
    for (const path of CANVAS_RUNTIME_SOURCES)
      expect(path).toMatch(/^src\/(?:canvas-runtime|rich-text|core)\//);
    expect(CANVAS_RUNTIME_BUNDLE).not.toMatch(/\beval\(|new Function\(/);
  });

  it('appends only an escaped configuration after the bundle', () => {
    const source = new CanvasBridgeScript().source({
      nonce: 'nonce',
      revision: 3,
      regions: [],
      readOnly: false,
      labels: {
        edit: '</script><script>attack()</script>\u2028',
        move: 'm',
        up: 'u',
        down: 'd',
        duplicate: 'c',
        remove: 'r',
        before: 'b',
        after: 'a',
        inside: 'i',
        parent: 'p',
        html: 'h',
        image: 'g',
        add: '+',
        resize: 'z',
        resizeHint: 'k',
        replace: 'x',
        embed: 'e',
      },
    });
    expect(source.startsWith(CANVAS_RUNTIME_BUNDLE)).toBe(true);
    const call = source.slice(CANVAS_RUNTIME_BUNDLE.length);
    expect(call.startsWith(';__lyadsCanvas({')).toBe(true);
    expect(call.endsWith('});')).toBe(true);
    expect(call).not.toContain('<');
    expect(call).not.toMatch(/[\u2028\u2029]/);
    expect(call).toContain('\\u003c/script>');
  });
});
