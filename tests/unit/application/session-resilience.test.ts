import { describe, expect, it } from 'vitest';
import { EditorFactory } from '../../../src/composition/factory';
import { EditorSession } from '../../../src/application/session';
import type { EditorState } from '../../../src/application/session';
import { ContentService } from '../../../src/application/content-service';
import type { CodecPort } from '../../../src/application/content-service';
import { DocumentMutationService } from '../../../src/application/document-commands';
import { ImageLinkService } from '../../../src/application/image-link';
import { HostIntegration } from '../../../src/application/host';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { CssDocumentCodec } from '../../../src/codecs/css';
import { ContentPolicy } from '../../../src/security/policy';
import { UrlPolicy } from '../../../src/security/url-policy';
import { SecureIdentifier } from '../../../src/security/identity';
import { BlockCatalog } from '../../../src/core/catalog';
import { DocumentHistory } from '../../../src/core/history';

const factory = new EditorFactory(() => ({
  async compile() {
    throw new Error('Not used by this fixture');
  },
}));

function sessionWithFailingExport() {
  const policy = new ContentPolicy();
  const real = new HtmlDocumentCodec(policy);
  const control: { failOn?: string } = {};
  const codec: CodecPort = {
    import: (source, kind, previous) => real.import(source, kind, previous),
    inspect: (source, kind) => real.inspect(source, kind),
    export: (document) => {
      const output = real.export(document);
      if (control.failOn && output.html.includes(control.failOn))
        throw new Error('SERIALIZED_STRUCTURE_CHANGED');
      return output;
    },
  };
  const content = new ContentService(codec, policy, new CssDocumentCodec());
  const imported = content.import({ html: '<p>um</p>', css: '' }, 'page');
  if (!imported.document) throw new Error('Invalid fixture');
  const session = new EditorSession(
    {
      content,
      mutations: new DocumentMutationService(content, new BlockCatalog()),
      imageLinks: new ImageLinkService(content, new UrlPolicy(), new SecureIdentifier()),
      history: new DocumentHistory(),
      host: new HostIntegration(),
    },
    { document: imported.document },
  );
  return { session, control };
}

describe('history restore fails cleanly', () => {
  it('keeps document, pointer and flags when undo cannot be serialized', () => {
    const { session, control } = sessionWithFailingExport();
    const id = session.snapshot().nodes[0]?.children?.[0]?.id ?? '';
    expect(session.updateText(id, 'dois')).toBe(true);
    expect(session.updateText(id, 'tres')).toBe(true);
    control.failOn = 'dois';
    const before = session.getState();
    expect(() => session.undo()).not.toThrow();
    expect(session.undo()).toBe(false);
    const failed = session.getState();
    expect(failed.diagnostics.map((item) => item.code)).toEqual(['HISTORY_RESTORE_FAILED']);
    expect(failed.document).toEqual(before.document);
    expect(failed.source).toEqual(before.source);
    expect(failed).toMatchObject({ canUndo: true, canRedo: false });
    delete control.failOn;
    expect(session.undo()).toBe(true);
    expect(session.exportSource().html).toBe('<p>dois</p>');
    expect(session.undo()).toBe(true);
    expect(session.exportSource().html).toBe('<p>um</p>');
    expect(session.getState()).toMatchObject({ canUndo: false, canRedo: true });
    session.dispose();
  });

  it('keeps the pointer when redo cannot be serialized', () => {
    const { session, control } = sessionWithFailingExport();
    const id = session.snapshot().nodes[0]?.children?.[0]?.id ?? '';
    expect(session.updateText(id, 'dois')).toBe(true);
    expect(session.undo()).toBe(true);
    control.failOn = 'dois';
    expect(session.redo()).toBe(false);
    expect(session.getState()).toMatchObject({ canUndo: false, canRedo: true });
    expect(session.exportSource().html).toBe('<p>um</p>');
    delete control.failOn;
    expect(session.redo()).toBe(true);
    expect(session.exportSource().html).toBe('<p>dois</p>');
    session.dispose();
  });
});

describe('a failing observer keeps its subscription', () => {
  it('isolates one exception, reports it and keeps delivering later states', () => {
    const errors: unknown[] = [];
    const { session } = factory.create({
      source: { html: '<p>um</p>', css: '' },
      onObserverError: (error) => errors.push(error),
    });
    const seen: string[] = [];
    const healthy: string[] = [];
    let fail = false;
    session.subscribe((state: EditorState) => {
      if (fail) throw new Error('render failed once');
      seen.push(state.source.html);
    });
    session.subscribe((state: EditorState) => healthy.push(state.source.html));
    const id = session.snapshot().nodes[0]?.children?.[0]?.id ?? '';
    fail = true;
    expect(session.updateText(id, 'dois')).toBe(true);
    fail = false;
    expect(session.updateText(id, 'tres')).toBe(true);
    expect(errors).toHaveLength(1);
    expect(seen).toEqual(['<p>um</p>', '<p>tres</p>']);
    expect(healthy).toEqual(['<p>um</p>', '<p>dois</p>', '<p>tres</p>']);
    session.dispose();
  });

  it('survives an observer and an error handler which both throw', () => {
    const { session } = factory.create({
      source: { html: '<p>um</p>', css: '' },
      onObserverError: () => {
        throw new Error('handler failed');
      },
    });
    let calls = 0;
    expect(() =>
      session.subscribe(() => {
        calls += 1;
        throw new Error('always fails');
      }),
    ).not.toThrow();
    const id = session.snapshot().nodes[0]?.children?.[0]?.id ?? '';
    expect(session.updateText(id, 'dois')).toBe(true);
    expect(session.updateText(id, 'tres')).toBe(true);
    expect(calls).toBe(3);
    expect(session.exportSource().html).toBe('<p>tres</p>');
    session.dispose();
  });

  it('terminates when the error handler answers every failure with a new emission', () => {
    const editor = factory.create({
      source: { html: '<p>um</p><p>dois</p>', css: '' },
      onObserverError: () => {
        handled += 1;
        if (handled > 50) throw new Error('RUNAWAY_REDELIVERY');
        const [first, second] = editor.session.snapshot().nodes;
        const next =
          editor.session.getState().selectedNodeId === first?.id ? second?.id : first?.id;
        editor.session.select(next);
      },
    });
    let handled = 0;
    const { session } = editor;
    let failing = 0;
    const healthy: (string | undefined)[] = [];
    session.subscribe(() => {
      failing += 1;
      throw new Error('always fails');
    });
    session.subscribe((state: EditorState) => healthy.push(state.selectedNodeId));
    // Subscription delivery: one failure, one reaction, then one failure inside that emission.
    expect(handled).toBe(2);
    expect(failing).toBe(2);
    const id = session.snapshot().nodes[0]?.children?.[0]?.id ?? '';
    handled = 0;
    failing = 0;
    healthy.length = 0;
    expect(session.updateText(id, 'tres')).toBe(true);
    // One delivery to the failing listener per emission, however often the handler re-emits.
    expect(failing).toBe(1);
    expect(handled).toBe(1);
    expect(healthy.at(-1)).toBe(session.getState().selectedNodeId);
    // It is still subscribed: the next emission reaches it again, once.
    expect(session.updateText(id, 'quatro')).toBe(true);
    expect(failing).toBe(2);
    expect(handled).toBe(2);
    expect(session.exportSource().html).toBe('<p>quatro</p><p>dois</p>');
    session.dispose();
  });
});
