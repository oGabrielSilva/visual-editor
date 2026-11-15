import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlockDocument } from '../../../src/core/block-document';
import type { Block, BlockDocumentData } from '../../../src/core/block-document';
import type { DocumentKind } from '../../../src/core/document';
import { BlockDefinitionRegistry } from '../../../src/blocks/definitions';
import { NodeMjmlCompiler } from '../../../src/compilation/node-compiler';

export const registry = new BlockDefinitionRegistry();

export function sequence(prefix = 'n'): () => string {
  let next = 0;
  return () => `${prefix}${++next}`;
}

export function section(id: string, columns: readonly Block[], props = {}): Block {
  return { id, type: 'section', props, children: columns };
}

export function column(id: string, children: readonly Block[], props = {}): Block {
  return { id, type: 'column', props, children };
}

export function data(
  blocks: readonly Block[],
  kind: DocumentKind = 'email',
  extra: Partial<BlockDocumentData> = {},
): BlockDocumentData {
  return {
    schemaVersion: 2,
    id: 'doc',
    kind,
    revision: 0,
    title: '',
    meta: { lang: 'pt-BR' },
    styles: {},
    blocks,
    ...extra,
  };
}

export function documentOf(
  blocks: readonly Block[],
  kind: DocumentKind = 'email',
  extra: Partial<BlockDocumentData> = {},
): BlockDocument {
  return BlockDocument.from(data(blocks, kind, extra), registry);
}

/** One section, one column, the given content blocks. */
export function simple(content: readonly Block[], kind: DocumentKind = 'email'): BlockDocument {
  return documentOf([section('s1', [column('c1', content)])], kind);
}

const WORKER = new URL('../../../dist/server-worker.js', import.meta.url);
/** Sources the worker bundle is built from. */
const WORKER_SOURCES = ['compilation', 'codecs', 'security', 'core'].map((directory) =>
  fileURLToPath(new URL(`../../../src/${directory}/`, import.meta.url)),
);

function newest(directory: string): number {
  return readdirSync(directory, { withFileTypes: true }).reduce((latest, entry) => {
    const path = join(directory, entry.name);
    return Math.max(latest, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs);
  }, 0);
}

/**
 * The compiler of the tests runs the built worker. A missing or stale build would test old
 * code, so it fails here, saying what to do.
 */
export function assertWorkerBuilt(): void {
  let built: number;
  try {
    built = statSync(WORKER).mtimeMs;
  } catch {
    throw new Error('dist/server-worker.js is missing: run `yarn build` before the tests.');
  }
  if (WORKER_SOURCES.some((directory) => newest(directory) > built))
    throw new Error('dist/server-worker.js is older than its sources: run `yarn build`.');
}

export function nodeCompiler(): NodeMjmlCompiler {
  assertWorkerBuilt();
  return new NodeMjmlCompiler(WORKER);
}
