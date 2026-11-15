import { describe, expect, it } from 'vitest';
import { EditorDocument } from '../../src/core/document';
import type { DocumentKind, DocumentNode, EditorDocumentData } from '../../src/core/document';
import { DocumentHistory } from '../../src/core/history';
import { BlockCatalog } from '../../src/core/catalog';
import { HtmlDocumentCodec } from '../../src/codecs/html';
import { CssDocumentCodec } from '../../src/codecs/css';
import { ContentPolicy } from '../../src/security/policy';
import { ContentService } from '../../src/application/content-service';
import { DocumentMutationService } from '../../src/application/document-commands';
import { ImageLinkService } from '../../src/application/image-link';
import { SecureIdentifier } from '../../src/security/identity';
import { UrlPolicy } from '../../src/security/url-policy';
import { HostIntegration } from '../../src/application/host';
import type { StorePort } from '../../src/application/host';
import { EditorSession } from '../../src/application/session';
import { EditorController } from '../../src/vue/controller';
import { TemplateCatalog } from '../../src/templates/catalog';
import { MjmlEmailRenderer } from '../../src/renderers/email-renderer';
import { HtmlDocumentAssembler } from '../../src/renderers/preview-document';
import { EditorFactory } from '../../src/composition/factory';

function createSession(
  html = '<p>Original</p>',
  store?: StorePort,
  kind: DocumentKind = 'page',
): EditorSession {
  const policy = new ContentPolicy();
  const catalog = new BlockCatalog();
  const codec = new HtmlDocumentCodec(policy, catalog);
  const content = new ContentService(codec, policy, new CssDocumentCodec());
  const imported = content.import({ html, css: '' }, kind);
  if (!imported.document) throw new Error('Fixture must be a valid document');
  return new EditorSession(
    {
      content,
      mutations: new DocumentMutationService(content, catalog),
      imageLinks: new ImageLinkService(content, new UrlPolicy(), new SecureIdentifier()),
      history: new DocumentHistory(),
      host: new HostIntegration(store ? { store } : {}),
    },
    { document: imported.document },
  );
}

function find(nodes: readonly DocumentNode[], tag: string): DocumentNode {
  for (const node of nodes) {
    if (node.tag === tag) return node;
    try {
      return find(node.children ?? [], tag);
    } catch {
      /* Inspect the next sibling. */
    }
  }
  throw new Error(`Fixture is missing ${tag}`);
}

describe('independent architecture fitness: document encapsulation', () => {
  it('does not share snapshots with the aggregate or history', () => {
    const session = createSession();
    const aggregate = EditorDocument.from(session.snapshot());
    const history = new DocumentHistory();
    history.push(aggregate);
    const external = aggregate.snapshot();
    Object.assign(external.nodes[0] ?? {}, { tag: 'script' });
    expect(aggregate.snapshot().nodes[0]?.tag).toBe('p');
    expect(history.current()?.snapshot().nodes[0]?.tag).toBe('p');
  });

  it('keeps sessions isolated and undo revisions monotonic', () => {
    const first = createSession();
    const second = createSession();
    expect(first.updateText(find(first.snapshot().nodes, 'p').id, 'Changed')).toBe(true);
    const updatedRevision = first.snapshot().revision;
    expect(first.undo()).toBe(true);
    expect(first.snapshot().revision).toBeGreaterThan(updatedRevision);
    expect(first.exportSource().html).toContain('Original');
    expect(second.snapshot().revision).toBe(0);
    expect(second.getState().canUndo).toBe(false);
    expect(second.exportSource().html).toBe('<p>Original</p>');
  });
});

describe('independent architecture fitness: source and command integrity', () => {
  it('can import a portable JSON export whose valid Unicode content exceeds one MiB as UTF-8', async () => {
    const factory = new EditorFactory(() => ({
      async compile() {
        return '<p>Template</p>';
      },
    }));
    const text = '文'.repeat(400_000);
    const first = factory.create({ source: { html: `<p>${text}</p>`, css: '' } });
    const reopened = factory.create({ source: { html: '<p>Empty target</p>', css: '' } });
    try {
      const file = new File([first.controller.exportJson()], 'portable.json', {
        type: 'application/json',
      });
      expect(file.size).toBeGreaterThan(1_048_576);
      expect(await reopened.controller.importFile(file)).toBe(true);
      expect(find(reopened.session.snapshot().nodes, 'p').children?.[0]?.value).toBe(text);
    } finally {
      first.dispose();
      reopened.dispose();
    }
  });

  it('can reopen its own recovery backup for an accepted document while keeping an unsafe pending draft inert', async () => {
    const factory = new EditorFactory(() => ({
      async compile() {
        return '<p>Template</p>';
      },
    }));
    const html = `<p>${'x'.repeat(600_000)}</p>`;
    const first = factory.create({ source: { html, css: '' } });
    const reopened = factory.create({ source: { html: '<p>Empty target</p>', css: '' } });
    try {
      first.session.setMode('html');
      // A buffer is only invalid over the limits now: a script no longer refuses a page.
      const pending = { html: `${html}${'<div>'.repeat(300)}forbidden`, css: '' };
      first.session.setDraftSource(pending);
      const file = new File([first.controller.exportRecovery()], 'editor-recovery.json', {
        type: 'application/json',
      });
      expect(file.size).toBeGreaterThan(1_048_576);
      expect(await reopened.controller.importFile(file)).toBe(true);
      expect(reopened.session.getState().mode).toBe('html');
      expect(reopened.session.getState().draftSource).toEqual(pending);
      expect(reopened.session.exportSource().html).not.toContain('forbidden');
      expect(() => reopened.controller.exportHtml()).toThrow();
    } finally {
      first.dispose();
      reopened.dispose();
    }
  });

  it('does not grow default CSS or override existing author CSS when twenty LP blocks are inserted', async () => {
    const policy = new ContentPolicy();
    const codec = new HtmlDocumentCodec(policy);
    const session = createSession(
      '<section class="native"><p>Existing native content</p></section>',
    );
    const customCss =
      '/* Author formatting */\n.native { padding: 7px; }\n[data-editor-block="button"] { background: purple; }';
    expect(session.importSource({ html: session.exportSource().html, css: customCss })).toBe(true);
    const compiler = {
      async compile() {
        return '<p>Template</p>';
      },
    };
    const controller = new EditorController(
      session,
      new TemplateCatalog(new MjmlEmailRenderer(codec, policy, compiler)),
      new HtmlDocumentAssembler(codec, policy),
    );
    expect(await controller.addBlock('button')).toBe(true);
    const firstCss = session.exportSource().css;
    expect(firstCss.endsWith(customCss)).toBe(true);
    expect(firstCss.length).toBeGreaterThan(customCss.length);
    for (let index = 1; index < 20; index++) expect(await controller.addBlock('button')).toBe(true);
    expect(session.exportSource().css).toBe(firstCss);
    expect(session.exportSource().html).toContain('Existing native content');
    expect(find(session.snapshot().nodes, 'section').attrs?.class).toBe('native');
  });

  it('does not silently export the previous HTML revision when the source buffer changed', () => {
    const session = createSession();
    const policy = new ContentPolicy();
    const codec = new HtmlDocumentCodec(policy);
    const compiler = {
      async compile() {
        return '<p>Template</p>';
      },
    };
    const controller = new EditorController(
      session,
      new TemplateCatalog(new MjmlEmailRenderer(codec, policy, compiler)),
      new HtmlDocumentAssembler(codec, policy),
    );
    session.setMode('html');
    const draft = { html: '<p>Pending export edit</p>', css: '' };
    session.setDraftSource(draft);
    let output: string | undefined;
    try {
      output = controller.exportHtml();
    } catch {
      /* An explicit refusal preserves the recoverable draft. */
    }
    if (output !== undefined) expect(output).toContain('Pending export edit');
    else expect(session.getState().draftSource).toEqual(draft);
  });

  it('blocks HTML export while the source buffer cannot become a document', () => {
    const session = createSession();
    const policy = new ContentPolicy();
    const codec = new HtmlDocumentCodec(policy);
    const compiler = {
      async compile() {
        return '<p>Template</p>';
      },
    };
    const controller = new EditorController(
      session,
      new TemplateCatalog(new MjmlEmailRenderer(codec, policy, compiler)),
      new HtmlDocumentAssembler(codec, policy),
    );
    session.setMode('html');
    const draft = { html: `<p>Pending edit</p>${'<div>'.repeat(300)}too deep`, css: '' };
    session.setDraftSource(draft);
    expect(() => controller.exportHtml()).toThrow();
    expect(session.getState().draftSource).toEqual(draft);
    // A buffer with a script is a valid page and is exported as written.
    const scripted = { html: '<p>Pending edit</p><script>track()</script>', css: '' };
    session.setDraftSource(scripted);
    expect(controller.exportHtml()).toContain('<script>track()</script>');
  });

  it('marks an uncommitted HTML draft dirty', () => {
    const session = createSession();
    session.setMode('html');
    session.setDraftSource({ html: '<p>Pending edit</p>', css: '' });
    expect(session.getState().dirty).toBe(true);
  });

  it('does not silently lose a pending HTML buffer during undo', () => {
    const session = createSession();
    session.updateText(find(session.snapshot().nodes, 'p').id, 'Visual edit');
    session.setMode('html');
    const pending = { html: '<p>Uncommitted HTML edit</p>', css: '' };
    session.setDraftSource(pending);
    session.undo();
    // The implementation may refuse undo or preserve draft in a recoverable state.
    // It must not replace a user's uncommitted source with an older generated value.
    expect(session.getState().draftSource).toEqual(pending);
  });

  it('does not grant a container the destructive text-property command', () => {
    const session = createSession(
      '<section><p>Editable</p><table><tbody><tr><td>Native preserved</td></tr></tbody></table></section>',
    );
    const original = session.exportSource();
    expect(session.updateText(find(session.snapshot().nodes, 'section').id, 'Replacement')).toBe(
      false,
    );
    expect(session.exportSource()).toEqual(original);
  });

  it('rejects inserting a child under a void element rather than losing the child at export', () => {
    const session = createSession('<img src="https://example.com/image.png" alt="Sample">');
    const original = session.exportSource();
    expect(session.addBlock('text', find(session.snapshot().nodes, 'img').id)).toBe(false);
    expect(session.exportSource()).toEqual(original);
  });

  it('rejects an explicit missing insertion parent instead of inserting at root', () => {
    const session = createSession();
    const original = session.exportSource();
    expect(session.addBlock('text', 'missing-parent')).toBe(false);
    expect(session.exportSource()).toEqual(original);
  });

  it('can edit the declarative form reference exposed by the property panel', () => {
    const session = createSession('<div data-host-slot="form" class="host-form"></div>');
    const policy = new ContentPolicy();
    const codec = new HtmlDocumentCodec(policy);
    const compiler = {
      async compile() {
        return '<p>Template</p>';
      },
    };
    const controller = new EditorController(
      session,
      new TemplateCatalog(new MjmlEmailRenderer(codec, policy, compiler)),
      new HtmlDocumentAssembler(codec, policy),
    );
    const slot = find(session.snapshot().nodes, 'div');
    expect(controller.connectFormReference('form-reference', slot.id)).toBe(true);
    expect(controller.exportHtml()).toContain('data-host-reference="form-reference"');
  });

  it('keeps an empty declarative form slot selectable for the property panel', () => {
    const session = createSession('<div data-host-slot="form" class="host-form"></div>');
    const policy = new ContentPolicy();
    const codec = new HtmlDocumentCodec(policy);
    const compiler = {
      async compile() {
        return '<p>Template</p>';
      },
    };
    const controller = new EditorController(
      session,
      new TemplateCatalog(new MjmlEmailRenderer(codec, policy, compiler)),
      new HtmlDocumentAssembler(codec, policy),
    );
    const slot = find(session.snapshot().nodes, 'div');
    expect(controller.entries().some((entry) => entry.id === slot.id)).toBe(true);
    controller.select(slot.id);
    expect(controller.selected()?.id).toBe(slot.id);
  });

  it('does not connect malformed form references, native content, email documents or readonly sessions', () => {
    const page = createSession('<div data-host-slot="form"></div><p>Native content</p>');
    const original = page.exportSource();
    const slot = find(page.snapshot().nodes, 'div');
    for (const reference of ['', '../../another-workspace', '<script>', 'a'.repeat(129)]) {
      expect(page.connectFormReference(reference, slot.id)).toBe(false);
    }
    expect(page.connectFormReference('form-reference', find(page.snapshot().nodes, 'p').id)).toBe(
      false,
    );
    expect(page.exportSource()).toEqual(original);
    const email = createSession('<p>Email content</p>', undefined, 'email');
    expect(email.connectFormReference('form-reference')).toBe(false);
    const readonly = new EditorFactory(() => ({
      async compile() {
        return '<p>Template</p>';
      },
    })).create({ readOnly: true, source: { html: '<div data-host-slot="form"></div>', css: '' } });
    expect(readonly.session.connectFormReference('form-reference')).toBe(false);
    readonly.dispose();
  });

  it('rejects block children in a paragraph rather than allowing parser reparenting on the next mode switch', () => {
    const session = createSession();
    const original = session.exportSource();
    expect(session.addBlock('section', find(session.snapshot().nodes, 'p').id)).toBe(false);
    expect(session.exportSource()).toEqual(original);
  });

  it('does not move a table cell outside the table and silently lose its structure on HTML reimport', () => {
    const session = createSession(
      '<table><tbody><tr><td data-native="preserved">Native cell</td><td>Other</td></tr></tbody></table><section><p>Target</p></section>',
    );
    const original = session.exportSource();
    const cell = find(session.snapshot().nodes, 'td');
    const target = find(session.snapshot().nodes, 'section');
    expect(session.moveBlock(cell.id, target.id, 0)).toBe(false);
    expect(session.exportSource()).toEqual(original);
  });

  it('does not commit a JSON revision when serialization fails', () => {
    const session = createSession();
    const original = session.snapshot();
    const malformed: EditorDocumentData = {
      ...original,
      nodes: [
        {
          id: 'malformed-doctype',
          type: 'doctype',
          value: 'html',
          attrs: { publicId: '\u0000', systemId: '' },
        },
        ...original.nodes,
      ],
    };
    expect(session.importJson(malformed)).toBe(false);
    expect(session.snapshot()).toEqual(original);
    expect(session.exportSource().html).toBe('<p>Original</p>');
  });
});

describe('independent architecture fitness: persistence revisions', () => {
  it('accepts the next save after the document was edited while the previous save was pending', async () => {
    let persistedRevision = 0;
    let completeFirst: (() => void) | undefined;
    let first = true;
    const accepted: EditorDocumentData[] = [];
    const store: StorePort = {
      async save(document, _source, expectedRevision) {
        if (expectedRevision !== persistedRevision) throw new Error('REVISION_CONFLICT');
        if (first) {
          first = false;
          await new Promise<void>((resolve) => {
            completeFirst = resolve;
          });
        }
        accepted.push(document);
        persistedRevision++;
        return { revision: persistedRevision };
      },
    };
    const session = createSession('<p>Original</p>', store);
    const id = find(session.snapshot().nodes, 'p').id;
    session.updateText(id, 'First edit');
    const inFlight = session.save();
    session.updateText(id, 'Second edit');
    completeFirst?.();
    await inFlight;
    expect(session.getState().dirty).toBe(true);
    expect(await session.save()).toBe(true);
    expect(accepted).toHaveLength(2);
    expect(accepted[1]?.nodes[0]?.children?.[0]?.value).toBe('Second edit');
    expect(session.getState().dirty).toBe(false);
  });
});

describe('independent architecture fitness: asynchronous presentation jobs', () => {
  it('does not let a late template compilation discard a newer uncommitted HTML buffer', async () => {
    const session = createSession('<p>Original</p>', undefined, 'email');
    let finishCompile: (() => void) | undefined;
    const compiler = {
      async compile() {
        await new Promise<void>((resolve) => {
          finishCompile = resolve;
        });
        return '<p>Late template</p>';
      },
    };
    const policy = new ContentPolicy();
    const codec = new HtmlDocumentCodec(policy);
    const controller = new EditorController(
      session,
      new TemplateCatalog(new MjmlEmailRenderer(codec, policy, compiler)),
      new HtmlDocumentAssembler(codec, policy),
    );
    const pending = controller.applyTemplate('email-welcome');
    session.setMode('html');
    const draft = { html: '<p>New uncommitted edit</p>', css: '' };
    session.setDraftSource(draft);
    finishCompile?.();
    expect(await pending).toBe(false);
    expect(session.getState().draftSource).toEqual(draft);
    expect(session.exportSource().html).toContain('Original');
  });

  it('does not let a late template compilation overwrite newer edits', async () => {
    const session = createSession('<p>Original</p>', undefined, 'email');
    let finishCompile: (() => void) | undefined;
    const compiler = {
      async compile() {
        await new Promise<void>((resolve) => {
          finishCompile = resolve;
        });
        return '<p>Late template</p>';
      },
    };
    const policy = new ContentPolicy();
    const codec = new HtmlDocumentCodec(policy);
    const controller = new EditorController(
      session,
      new TemplateCatalog(new MjmlEmailRenderer(codec, policy, compiler)),
      new HtmlDocumentAssembler(codec, policy),
    );
    const pending = controller.applyTemplate('email-welcome');
    expect(session.updateText(find(session.snapshot().nodes, 'p').id, 'Newer edit')).toBe(true);
    finishCompile?.();
    expect(await pending).toBe(false);
    expect(session.exportSource().html).toContain('Newer edit');
    expect(session.exportSource().html).not.toContain('Late template');
  });
});
