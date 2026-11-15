import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../src/', import.meta.url));

function files(directory: string, extensions: readonly string[]): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory()
      ? files(path, extensions)
      : extensions.some((extension) => entry.name.endsWith(extension))
        ? [path]
        : [];
  });
}
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
function imports(path: string): string[] {
  return [...read(path).matchAll(/(?:from|import)\s+'([^']+)'/g)].map((match) => match[1] ?? '');
}
/** The path of a relative import, from the source root. */
function target(path: string, dependency: string): string {
  return relative(root, resolve(join(root, dirname(path)), dependency)).replaceAll('\\', '/');
}
const lines = (path: string): number => read(path).split('\n').length;

describe('the shell is made of small modules with one direction of dependency', () => {
  it('keeps the frame runtime free of the host: only itself, the rich text and core', () => {
    const violations: string[] = [];
    for (const path of files('canvas-runtime', ['.ts']))
      for (const dependency of imports(path)) {
        if (!dependency.startsWith('.')) continue;
        const module = target(path, dependency).split('/')[0];
        // The contract of the bridge is imported as types only and erased from the bundle.
        const typeOnly = new RegExp(`import type [^;]*'${dependency.replaceAll('.', '\\.')}'`).test(
          read(path),
        );
        if (!['canvas-runtime', 'rich-text', 'core'].includes(module ?? '') && !typeOnly)
          violations.push(`${path} -> ${dependency}`);
      }
    expect(violations).toEqual([]);
  });

  it('lets the host reach the runtime only through its shared, DOM-free contracts', () => {
    const violations: string[] = [];
    for (const path of [...files('vue', ['.ts', '.vue']), ...files('security', ['.ts'])])
      for (const dependency of imports(path)) {
        if (!dependency.startsWith('.')) continue;
        const resolved = target(path, dependency);
        if (
          resolved.startsWith('canvas-runtime/') &&
          !resolved.startsWith('canvas-runtime/shared/')
        )
          violations.push(`${path} -> ${dependency}`);
      }
    expect(violations).toEqual([]);
    for (const path of files('canvas-runtime/shared', ['.ts'])) {
      expect(imports(path), path).toEqual([]);
      expect(read(path), path).not.toMatch(/\b(?:document|window|navigator)\./);
    }
  });

  it('keeps services and coordinators independent of components and of each other in cycles', () => {
    const violations: string[] = [];
    for (const path of [
      ...files('vue/services', ['.ts']),
      ...files('vue/canvas', ['.ts']),
      ...files('vue/properties', ['.ts']),
    ])
      for (const dependency of imports(path)) {
        if (
          dependency.endsWith('.vue') &&
          !new RegExp(`import type [^;]*'${dependency}'`).test(read(path))
        )
          violations.push(`${path} -> ${dependency}`);
        if (dependency.startsWith('.') && target(path, dependency) === 'vue/workbench')
          if (!/import type [^;]*workbench'/.test(read(path)))
            violations.push(`${path} -> workbench`);
      }
    expect(violations).toEqual([]);
  });

  it('uses Nuxt UI primitives only inside the wrappers of the package', () => {
    const violations: string[] = [];
    for (const path of files('vue', ['.ts', '.vue'])) {
      if (path.startsWith('vue/components/ui/')) continue;
      if (imports(path).some((dependency) => dependency.startsWith('@nuxt/ui/')))
        violations.push(path);
    }
    // The path of the selection composes the breadcrumb primitive with the package's own buttons.
    expect(violations).toEqual(['vue/components/EditorSelectionPath.vue']);
  });

  it('has one door for each kind of change: nothing else in the shell calls the controller for it', () => {
    // Everything which changes the document, by the name of the controller method. A call is
    // recognized by its receiver, so `element.remove()` or the history of the text editor of the
    // panel never count.
    const commands = [
      'applyCanvasAction',
      'moveTo',
      'move',
      'drop',
      'duplicate',
      'remove',
      'addBlock',
      'addBlockAt',
      'appendBlock',
      'insertSource',
      'appendSource',
      'replaceSource',
      'resizeImage',
      'attachAsset',
      'connectFormReference',
      'undo',
      'redo',
      'update[A-Z]\\w*',
      'beginRichText',
      'commitRichText',
      'cancelRichText',
    ];
    const call = new RegExp(
      `\\b(?:controller(?:\\(\\))?|owner)\\s*\\.\\s*(?:${commands.join('|')})\\(`,
    );
    // The doors: blocks, properties and panel text, images, the text edited in the piece, the
    // grouping of history steps, and the workbench which owns history, saving and the mode.
    const doors = new Set([
      'vue/controller.ts',
      'vue/workbench.ts',
      // Block pieces: every change runs inside `BlockWorkbench.run`, history and saving included.
      'vue/block-workbench.ts',
      'vue/services/block-commands.ts',
      'vue/services/property-commands.ts',
      'vue/services/image-requests.ts',
      'vue/services/live-change.ts',
      'vue/canvas/inline-text.ts',
    ]);
    const violations: string[] = [];
    for (const path of files('vue', ['.vue', '.ts']))
      if (!doors.has(path) && !path.startsWith('vue/session/') && call.test(read(path)))
        violations.push(path);
    expect(violations).toEqual([]);
    // The rule sees the calls it is meant to see.
    for (const sample of [
      'props.controller.resizeImage(id, 1, 2)',
      'workbench.controller().undo()',
      `workbench
      .controller()
      .updateImageLink(href)`,
      'removal.owner.applyCanvasAction(removal.id)',
      'controller.remove()',
    ])
      expect(call.test(sample), sample).toBe(true);
    for (const sample of ['element.remove()', 'instance.can().undo()', 'remote.update(state)'])
      expect(call.test(sample), sample).toBe(false);
  });

  it('keeps every module of the shell and of the runtime within a readable size', () => {
    const large = [
      ...files('vue', ['.ts', '.vue']),
      ...files('canvas-runtime', ['.ts']),
      'security/preview-message.ts',
      'renderers/selection-preview.ts',
    ]
      .filter((path) => !path.endsWith('icon-data.ts'))
      .map((path) => [path, lines(path)] as const)
      .filter(([, count]) => count > 400)
      .map(([path]) => path)
      .sort();
    // Known exceptions, each one a single responsibility which is long by nature: the text editor
    // of the frame and the frame host.
    expect(large).toEqual([
      'canvas-runtime/text-editor.ts',
      'vue/components/SelectionPreviewFrame.vue',
    ]);
  });
});
