import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { parseAnyDocument } from '../../../src/core/any-document';
import { BlockDocument } from '../../../src/core/block-document';
import { DocumentValidationError, EditorDocument } from '../../../src/core/document';
import { BlockMjmlGenerator } from '../../../src/blocks/email-generator';
import { BlockEmailRenderer } from '../../../src/blocks/email-renderer';
import { BlockPageGenerator } from '../../../src/blocks/page-generator';
import { BlockToHtmlConversion } from '../../../src/blocks/conversion';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { ContentPolicy } from '../../../src/security/policy';
import { BlockTemplateCatalog } from '../../../src/templates/blocks/catalog';
import { TemplateCatalog } from '../../../src/templates/catalog';
import { MjmlEmailRenderer } from '../../../src/renderers/email-renderer';
import { data, nodeCompiler, registry, sequence } from './support';

const compiler = nodeCompiler();
const codec = new HtmlDocumentCodec(new ContentPolicy());
const emails = new BlockEmailRenderer(new BlockMjmlGenerator(registry), compiler);
const pages = new BlockPageGenerator(registry);
const templates = new BlockTemplateCatalog(registry);
afterAll(() => compiler.dispose());

const schema1 = (): unknown => {
  const imported = codec.import({ html: '<p>Antigo</p>', css: 'p{color:red}' }, 'page');
  if (!imported.document) throw new Error('fixture');
  return imported.document;
};

describe('coexistence of schema 1 and schema 2', () => {
  it('dispatches by version without converting', () => {
    const old = parseAnyDocument(schema1(), registry);
    expect(old.schemaVersion).toBe(1);
    expect(old.document).toBeInstanceOf(EditorDocument);
    const block = parseAnyDocument(data([]), registry);
    expect(block.schemaVersion).toBe(2);
    expect(block.document).toBeInstanceOf(BlockDocument);
    for (const input of [null, [], 'x', { schemaVersion: 3 }, { schemaVersion: '2' }, {}])
      expect(() => parseAnyDocument(input, registry)).toThrow(DocumentValidationError);
    expect(() => parseAnyDocument({ schemaVersion: 3 }, registry)).toThrow(
      'UNSUPPORTED_SCHEMA_VERSION',
    );
  });

  it('opens and saves an old document unchanged', () => {
    const input = schema1();
    const parsed = parseAnyDocument(input, registry);
    if (parsed.schemaVersion !== 1) throw new Error('version');
    expect(parsed.document.snapshot()).toEqual(input);
    expect(codec.export(parsed.document)).toEqual({ html: '<p>Antigo</p>', css: 'p{color:red}' });
  });

  it('keeps the schema 1 templates in place', () => {
    const legacy = new TemplateCatalog(
      new MjmlEmailRenderer(codec, new ContentPolicy(), compiler),
    ).list('email');
    expect(legacy.map((entry) => entry.id)).toEqual([
      'email-newsletter',
      'email-welcome',
      'email-announcement',
    ]);
  });
});

describe('block templates', () => {
  it('lists two e-mail models besides the blank one and two page models', () => {
    expect(templates.list('email').map((entry) => entry.id)).toEqual([
      'email-blank',
      'email-newsletter',
      'email-welcome',
    ]);
    expect(templates.list('page').map((entry) => entry.id)).toEqual([
      'page-material',
      'page-event',
    ]);
  });

  it('creates pieces with new ids and compiles every e-mail model', async () => {
    for (const entry of templates.list('email')) {
      const document = templates.create(entry.id, `doc-${entry.id}`, sequence('x'));
      expect(document.blocks[0]?.id).toBe('x1');
      expect(document.revision).toBe(0);
      const output = await emails.render(document, 'final');
      const imported = codec.import(output, 'email');
      expect(imported.diagnostics.filter((item) => item.severity !== 'info')).toEqual([]);
    }
  }, 60_000);

  it('generates every page model', () => {
    for (const entry of templates.list('page')) {
      const document = templates.create(entry.id, `doc-${entry.id}`, sequence('x'));
      const output = pages.toHtml(document, 'final');
      expect(output.html).toContain('data-host-slot="form"');
      expect(codec.import(output, 'page').document).toBeDefined();
    }
  });

  it('makes a blank piece of either kind', () => {
    expect(templates.blank('email', 'e', sequence()).kind).toBe('email');
    expect(templates.blank('page', 'p', sequence()).find('n3')?.type).toBe('text');
    expect(() => templates.create('missing', 'x', sequence())).toThrow('template.not_found');
  });
});

describe('block labels', () => {
  it('resolves every label key in the package catalogs', () => {
    const editor = JSON.parse(
      readFileSync(new URL('../../../src/vue/locales/pt-BR.json', import.meta.url), 'utf8'),
    ) as Record<string, string>;
    const known = new Set(Object.keys(editor));
    const keys = [
      ...registry.labelKeys(),
      ...[...templates.list('email'), ...templates.list('page')].flatMap((entry) => [
        entry.titleKey,
        entry.descriptionKey,
      ]),
    ];
    expect(keys.filter((key) => !known.has(key))).toEqual([]);
    // The labels of the blocks live in the one catalog of the shell.
    for (const key of keys) expect(editor[key], key).not.toMatch(/[—–]/);
  });

  it('exposes the fields of every type with tabs and inheritance', () => {
    for (const definition of registry.list('page')) {
      for (const field of definition.fields) {
        expect(['content', 'style', 'advanced']).toContain(field.tab);
        if (field.inherits) expect(registry.styles.has(field.inherits)).toBe(true);
      }
    }
    expect(registry.list('email').map((definition) => definition.type)).not.toContain('form');
    expect(registry.field('button', 'background')?.inherits).toBe('button.background');
    expect(registry.textKeys('button')).toEqual(['text']);
    expect(registry.textKeys('image')).toEqual([]);
  });
});

describe('conversion to editable HTML (schema 2 to schema 1, one way)', () => {
  const conversion = new BlockToHtmlConversion(codec, emails, pages);

  it('turns a block e-mail into an HTML document of the editor', async () => {
    const block = templates
      .create('email-newsletter', 'piece-1', sequence('x'))
      .withTitle('Interna');
    const converted = await conversion.convert(block);
    expect(converted.schemaVersion).toBe(1);
    expect(converted.id).toBe('piece-1');
    expect(converted.title).toBe('Interna');
    expect(converted.revision).toBe(block.revision + 1);
    expect(converted.kind).toBe('email');
    const html = codec.export(converted).html;
    expect(html).toContain('Olá, Nico Robin');
    expect(html).not.toContain('data-visual-editor');
    expect(
      new ContentPolicy().validate(converted).filter((item) => item.severity === 'error'),
    ).toEqual([]);
  }, 30_000);

  it('turns a block page into an HTML document with its CSS', async () => {
    const block = templates.create('page-event', 'piece-2', sequence('x'));
    const converted = await conversion.convert(block);
    expect(converted.kind).toBe('page');
    expect(converted.css).toContain(':root{');
    expect(codec.export(converted).html).toContain('<main class="ve-page" lang="pt-BR">');
  });
});
