import { afterAll, describe, expect, it } from 'vitest';
import type { Block } from '../../../src/core/block-document';
import { BlockDefinitionRegistry } from '../../../src/blocks/definitions';
import { BlockMjmlGenerator } from '../../../src/blocks/email-generator';
import { BlockPageGenerator } from '../../../src/blocks/page-generator';
import { BlockDocument } from '../../../src/core/block-document';
import { COMPILE_LIMITS } from '../../../src/compilation/guard';
import { column, data, nodeCompiler, section } from './support';

/**
 * Measures, does not certify: the numbers depend on the machine. With `VE_MEASURE=1` they are
 * written to the standard output; the assertions only keep them far from the hard limits.
 */
const compiler = nodeCompiler();
afterAll(() => compiler.dispose());

/** Sections of one column with a heading, a text and a button: five blocks each. */
function blocks(total: number): Block[] {
  return Array.from({ length: Math.ceil(total / 5) }, (_, index) =>
    section(`s${index}`, [
      column(`c${index}`, [
        { id: `h${index}`, type: 'heading', props: { text: `Título ${index}` } },
        {
          id: `t${index}`,
          type: 'text',
          props: {
            text: `<p>Parágrafo ${index} com <strong>destaque</strong> e <a href="https://x.y/${index}">link</a>.</p>`,
          },
        },
        {
          id: `b${index}`,
          type: 'button',
          props: { text: `Ação ${index}`, href: `https://x.y/b${index}` },
        },
      ]),
    ]),
  );
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function time(action: () => unknown, runs = 3): Promise<number> {
  const values: number[] = [];
  for (let run = 0; run < runs; run++) {
    const start = performance.now();
    await action();
    values.push(performance.now() - start);
  }
  return Math.round(median(values));
}

describe('block documents: measured cost', () => {
  it('measures validation, generation and MJML compilation for 50, 200 and 800 blocks', async () => {
    const results: Record<string, unknown>[] = [];
    // Worker start, MJML and output check of an empty e-mail: the fixed part of every compile.
    const empty =
      '<mjml><mj-body><mj-section><mj-column></mj-column></mj-section></mj-body></mjml>';
    await compiler.compile(empty);
    results.push({ blocks: 0, compileMs: await time(() => compiler.compile(empty)) });
    for (const total of [50, 200, 800]) {
      // A fresh registry each time: the text cache of the guard starts empty.
      const fresh = () => new BlockDefinitionRegistry();
      const input = data(blocks(total));
      const coldValidation = await time(() => BlockDocument.from(input, fresh()), 1);
      const registry = fresh();
      const document = BlockDocument.from(input, registry);
      const warmValidation = await time(() => BlockDocument.from(input, registry));
      const operation = await time(() => document.updateProps('t0', { color: '#112233' }));
      const generator = new BlockMjmlGenerator(registry);
      const generation = await time(() => generator.toMjml(document, 'final'));
      const mjml = generator.toMjml(document, 'final');
      const bytes = new TextEncoder().encode(mjml.source).length;
      let compile: number | string = 'over COMPILE_LIMITS.sourceBytes';
      let htmlBytes = 0;
      if (bytes <= COMPILE_LIMITS.sourceBytes) {
        await compiler.compileGenerated(mjml);
        compile = await time(() => compiler.compileGenerated(mjml));
        htmlBytes = new TextEncoder().encode(await compiler.compileGenerated(mjml)).length;
        expect(compile).toBeLessThan(COMPILE_LIMITS.timeoutMs);
      }
      const pageDocument = BlockDocument.from(data(blocks(total), 'page'), registry);
      const page = await time(() => new BlockPageGenerator(registry).toHtml(pageDocument, 'final'));
      results.push({
        blocks: total,
        coldValidationMs: coldValidation,
        warmValidationMs: warmValidation,
        updatePropsMs: operation,
        mjmlGenerationMs: generation,
        mjmlBytes: bytes,
        compileMs: compile,
        htmlBytes,
        pageGenerationMs: page,
      });
    }
    if (process.env.VE_MEASURE === '1')
      process.stdout.write(`\nVE_MEASURE ${JSON.stringify(results)}\n`);
    expect(results).toHaveLength(4);
  }, 180_000);
});

describe('block sessions: an action on a large piece', () => {
  /**
   * The cost of one action of the author on a piece of 800 blocks, as the shell sees it: the
   * command, the new state handed to the listeners and the preview of a page. The goal of the
   * plan is under 100 ms; the compilation of an e-mail preview is measured apart above.
   */
  it('runs every command of 800 blocks in under 100 ms', async () => {
    const { BlockEditorSession } = await import('../../../src/application/block-session');
    const { BlockOutputRenderer } = await import('../../../src/blocks/block-output');
    const { BlockEmailRenderer } = await import('../../../src/blocks/email-renderer');
    const registry = new BlockDefinitionRegistry();
    const pages = new BlockPageGenerator(registry);
    const output = new BlockOutputRenderer(
      registry,
      pages,
      new BlockEmailRenderer(new BlockMjmlGenerator(registry), {
        compileGenerated: () => Promise.reject(new Error('unused')),
      }),
    );
    let next = 0;
    const session = new BlockEditorSession(
      {
        factory: registry,
        output: { render: (piece) => output.render(piece) },
        identifiers: { next: () => `${++next}`.padStart(20, '0') },
      },
      { document: BlockDocument.from(data(blocks(800), 'page'), registry) },
    );
    let delivered = 0;
    session.subscribe(() => delivered++);
    const action = async (run: () => unknown): Promise<number> =>
      time(async () => {
        run();
        await output.preview(session.document());
      }, 5);
    const results = {
      // A new value on every run, so each one is a real step of history.
      updateProps: await action(() =>
        session.updateProps('t3', { color: `#1122${String(++next % 90).padStart(2, '0')}` }),
      ),
      mobileValue: await action(() =>
        session.updateProps('t3', { fontSize: `${12 + (++next % 30)}px` }, 'mobile'),
      ),
      move: await action(() => session.move('s1', { position: 'after', id: 's100' })),
      duplicate: await action(() => session.duplicate('s2')),
      remove: await action(() => {
        const id = session.document().blocks.at(-1)?.id;
        if (id) session.remove(id);
      }),
      undo: await action(() => session.undo()),
      redo: await action(() => session.redo()),
      select: await action(() => session.select('t10')),
    };
    if (process.env.VE_MEASURE === '1')
      process.stdout.write(`\nVE_MEASURE_SESSION ${JSON.stringify(results)}\n`);
    expect(delivered).toBeGreaterThan(8);
    for (const value of Object.values(results)) expect(value).toBeLessThan(100);
  }, 120_000);
});
