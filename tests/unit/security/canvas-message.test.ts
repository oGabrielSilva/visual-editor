import { describe, expect, it } from 'vitest';
import { parse } from 'parse5';
import {
  PREVIEW_MESSAGE_BUDGETS,
  PreviewMessagePolicy,
} from '../../../src/security/preview-message';
import { SelectionPreviewRenderer } from '../../../src/renderers/selection-preview';
import { HtmlDocumentCodec } from '../../../src/codecs/html';
import { ContentPolicy } from '../../../src/security/policy';
import { HtmlDocumentAssembler } from '../../../src/renderers/preview-document';

const policy = new ContentPolicy();
const codec = new HtmlDocumentCodec(policy);
const renderer = new SelectionPreviewRenderer(
  codec,
  policy,
  new HtmlDocumentAssembler(codec, policy),
);
function fixture(readOnly = false) {
  const result = codec.import(
    {
      html: '<main><p>One <strong>logical</strong> region</p><p>Second</p><img alt="Safe"/></main>',
      css: '',
    },
    'page',
  );
  if (!result.document) throw new Error('Invalid fixture');
  const preview = renderer.build(result.document, 'Select', { readOnly });
  const text = preview.regions.find((region) => region.editable);
  const container = preview.regions.find((region) => region.container);
  if (!text || !container) throw new Error('Missing logical regions');
  return { preview, text, container, document: result.document };
}

function envelope(preview: ReturnType<typeof fixture>['preview'], type: string, sequence = 1) {
  return { type, nonce: preview.nonce, revision: preview.revision, sequence };
}

describe('typed canvas intents across an opaque frame', () => {
  it('keeps inline descendants atomic while preserving the canonical imported tree', () => {
    const { preview, document } = fixture();
    const ids: string[] = [];
    const findStrong = (nodes: typeof document.nodes): void => {
      for (const node of nodes) {
        if (node.tag === 'strong') ids.push(node.id);
        findStrong(node.children ?? []);
      }
    };
    findStrong(document.nodes);
    expect(ids).toHaveLength(1);
    expect(preview.nodeIds).not.toContain(ids[0]);
    const parsed = parse(preview.html);
    const strong: { text: string; selectable: boolean }[] = [];
    const walk = (node: (typeof parsed.childNodes)[number]): void => {
      if ('tagName' in node && node.tagName === 'strong')
        strong.push({
          text: node.childNodes.map((child) => ('value' in child ? child.value : '')).join(''),
          selectable: node.attrs.some((attribute) => attribute.name === 'data-visual-editor-node'),
        });
      if ('childNodes' in node) node.childNodes.forEach(walk);
    };
    parsed.childNodes.forEach(walk);
    expect(strong).toEqual([{ text: 'logical', selectable: false }]);
    expect(codec.export(document).html).toContain('<strong>logical</strong>');
    expect(codec.export(document).html).not.toContain('data-visual-editor-selected');
  });

  it('rejects another window, old revision, old nonce and replayed or jumped intents', () => {
    const { preview, text } = fixture();
    const messages = new PreviewMessagePolicy(() => 0);
    const frame = {};
    const valid = { ...envelope(preview, 'text-begin'), nodeId: text.id };
    expect(messages.canvas(valid, {}, frame, preview)).toBeUndefined();
    expect(
      messages.canvas({ ...valid, revision: preview.revision + 1 }, frame, frame, preview),
    ).toBeUndefined();
    expect(messages.canvas({ ...valid, nonce: 'wrong' }, frame, frame, preview)).toBeUndefined();
    expect(
      messages.canvas({ ...valid, sequence: Number.MAX_SAFE_INTEGER }, frame, frame, preview),
    ).toBeUndefined();
    expect(messages.canvas(valid, frame, frame, preview)?.type).toBe('text-begin');
    expect(messages.canvas(valid, frame, frame, preview)).toBeUndefined();
    expect(messages.canvas({ ...valid, sequence: 2 }, frame, frame, preview)?.type).toBe(
      'text-begin',
    );
    expect(
      messages.canvas(valid, frame, frame, renderer.build(fixture().document, 'Select')),
    ).toBeUndefined();
  });

  it('uses capabilities from the current document and refuses data, code and styles from the frame', () => {
    const { preview, text, container } = fixture();
    const frame = {};
    const messages = new PreviewMessagePolicy(() => 0);
    const base = envelope(preview, 'text-begin');
    expect(
      messages.canvas({ ...base, nodeId: container.id }, frame, frame, preview),
    ).toBeUndefined();
    expect(messages.canvas({ ...base, nodeId: 'missing' }, frame, frame, preview)).toBeUndefined();
    expect(
      messages.canvas(
        { ...base, nodeId: text.id, html: '<script>attack()</script>' },
        frame,
        frame,
        preview,
      ),
    ).toBeUndefined();
    expect(
      messages.canvas(
        { ...base, nodeId: text.id, style: 'background:url(https://attacker.test)' },
        frame,
        frame,
        preview,
      ),
    ).toBeUndefined();
    expect(
      messages.canvas(
        { ...envelope(preview, 'insertion'), targetId: text.id, placement: 'inside' },
        frame,
        frame,
        preview,
      ),
    ).toBeUndefined();
    expect(
      messages.canvas(
        { ...envelope(preview, 'insertion'), targetId: container.id, placement: 'inside' },
        frame,
        frame,
        preview,
      )?.type,
    ).toBe('insertion');
  });

  it('accepts read-only selection and measurement while denying all mutation intents', () => {
    const { preview, text, container } = fixture(true);
    const frame = {};
    const messages = new PreviewMessagePolicy(() => 0);
    expect(
      messages.selection(
        { type: 'selection', nonce: preview.nonce, revision: preview.revision, nodeId: text.id },
        frame,
        frame,
        preview,
      ),
    ).toBe(text.id);
    expect(
      messages.canvas(
        {
          ...envelope(preview, 'geometry'),
          nodeId: text.id,
          bounds: { x: 0, y: 0, width: 200, height: 20 },
          viewport: { x: 0, y: 20 },
        },
        frame,
        frame,
        preview,
      )?.type,
    ).toBe('geometry');
    const attempts = [
      { ...envelope(preview, 'text-begin', 2), nodeId: text.id },
      { ...envelope(preview, 'action', 2), nodeId: text.id, action: 'remove' },
      {
        ...envelope(preview, 'move', 2),
        sourceId: text.id,
        targetId: container.id,
        placement: 'inside',
      },
      { ...envelope(preview, 'insertion', 2), targetId: text.id, placement: 'after' },
    ];
    for (const attempt of attempts)
      expect(messages.canvas(attempt, frame, frame, preview)).toBeUndefined();
  });

  it('rejects nonfinite, negative, oversized or expanded geometry without consuming a valid sequence', () => {
    const { preview, text } = fixture();
    const messages = new PreviewMessagePolicy(() => 0);
    const frame = {};
    const valid = {
      ...envelope(preview, 'geometry'),
      nodeId: text.id,
      bounds: { x: -12, y: 30, width: 200, height: 20 },
      viewport: { x: 0, y: 200 },
    };
    for (const bounds of [
      { ...valid.bounds, x: NaN },
      { ...valid.bounds, y: Infinity },
      { ...valid.bounds, width: -1 },
      { ...valid.bounds, height: 100_001 },
      { ...valid.bounds, selector: 'body' },
    ])
      expect(messages.canvas({ ...valid, bounds }, frame, frame, preview)).toBeUndefined();
    expect(
      messages.canvas({ ...valid, viewport: { x: 0, y: 1_000_001 } }, frame, frame, preview),
    ).toBeUndefined();
    expect(messages.canvas(valid, frame, frame, preview)?.type).toBe('geometry');
  });

  it('bounds bursts, recovers after a time window and cannot be locked by a forged high sequence', () => {
    const { preview, text } = fixture();
    let now = 0;
    const messages = new PreviewMessagePolicy(() => now);
    const frame = {};
    const host = { selectedNodeId: text.id };
    const action = (sequence: number) => ({
      ...envelope(preview, 'action', sequence),
      nodeId: text.id,
      action: 'duplicate',
    });
    for (let sequence = 1; sequence <= 30; sequence += 1)
      expect(messages.canvas(action(sequence), frame, frame, preview, host)).toBeDefined();
    expect(messages.canvas(action(31), frame, frame, preview, host)).toBeUndefined();
    expect(
      messages.canvas(action(Number.MAX_SAFE_INTEGER), frame, frame, preview, host),
    ).toBeUndefined();
    now = 1_000;
    expect(messages.canvas(action(32), frame, frame, preview, host)).toBeDefined();
    const bounds = { x: 0, y: 0, width: 200, height: 20 };
    const geometry = (sequence: number) => ({
      ...envelope(preview, 'geometry', sequence),
      nodeId: text.id,
      bounds,
      viewport: { x: 0, y: 0 },
    });
    const last = 32 + PREVIEW_MESSAGE_BUDGETS.telemetry;
    for (let sequence = 33; sequence <= last; sequence += 1)
      expect(messages.canvas(geometry(sequence), frame, frame, preview)).toBeDefined();
    // Measurements are bounded on their own and never spend what intents may use.
    expect(messages.canvas(geometry(last + 1), frame, frame, preview)).toBeUndefined();
    expect(messages.canvas(action(last + 2), frame, frame, preview, host)).toBeDefined();
    now = 2_000;
    expect(messages.canvas(geometry(last + 3), frame, frame, preview)).toBeDefined();
    expect(messages.canvas(action(last + 4), frame, frame, preview, host)).toBeDefined();
  });

  it('keeps a ceiling for mutations and for selections regardless of the other classes', () => {
    const { preview, text } = fixture();
    const messages = new PreviewMessagePolicy(() => 0);
    const frame = {};
    const selection = {
      type: 'selection',
      nonce: preview.nonce,
      revision: preview.revision,
      nodeId: text.id,
    };
    for (let sequence = 1; sequence <= PREVIEW_MESSAGE_BUDGETS.mutation; sequence += 1)
      expect(
        messages.canvas(
          { ...envelope(preview, 'insertion', sequence), targetId: text.id, placement: 'after' },
          frame,
          frame,
          preview,
        ),
      ).toBeDefined();
    const refused = [
      { ...envelope(preview, 'text-commit', 1_000), nodeId: text.id, html: '<p>Texto</p>' },
      { ...envelope(preview, 'action', 1_000), nodeId: text.id, action: 'remove' },
      { ...envelope(preview, 'insertion', 1_000), targetId: text.id, placement: 'before' },
    ];
    for (const message of refused)
      expect(messages.canvas(message, frame, frame, preview)).toBeUndefined();
    const remaining = PREVIEW_MESSAGE_BUDGETS.intent - PREVIEW_MESSAGE_BUDGETS.mutation;
    for (let index = 0; index < remaining; index += 1)
      expect(messages.selection(selection, frame, frame, preview)).toBe(text.id);
    expect(messages.selection(selection, frame, frame, preview)).toBeUndefined();
  });

  it('escapes translated labels so they cannot close the only owned executable script', () => {
    const { document } = fixture();
    const unsafeLabel = '</script><script>attack()</script>';
    const preview = renderer.build(document, unsafeLabel, {
      labels: {
        edit: unsafeLabel,
        move: 'Move',
        up: 'Up',
        down: 'Down',
        duplicate: 'Copy',
        remove: 'Delete',
        before: 'Before',
        after: 'After',
        inside: 'Inside',
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
    const parsed = parse(preview.html);
    const scripts: string[] = [];
    const walk = (node: (typeof parsed.childNodes)[number]): void => {
      if ('tagName' in node && node.tagName === 'script')
        scripts.push(
          node.childNodes.map((child) => ('value' in child ? child.value : '')).join(''),
        );
      if ('childNodes' in node) for (const child of node.childNodes) walk(child);
    };
    for (const node of parsed.childNodes) walk(node);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('\\u003c/script>');
    expect(scripts[0]).not.toContain('</script>');
    expect(preview.html).not.toContain('allow-same-origin');
  });
});

it('authenticates a readiness handshake without granting a mutation or accepting replay', () => {
  const { preview } = fixture();
  const frame = {};
  const messages = new PreviewMessagePolicy(() => 0);
  const ready = envelope(preview, 'ready');
  expect(messages.canvas(ready, {}, frame, preview)).toBeUndefined();
  expect(messages.canvas({ ...ready, nonce: 'wrong' }, frame, frame, preview)).toBeUndefined();
  expect(
    messages.canvas({ ...ready, html: '<script>attack()</script>' }, frame, frame, preview),
  ).toBeUndefined();
  expect(messages.canvas(ready, frame, frame, preview)?.type).toBe('ready');
  expect(messages.canvas(ready, frame, frame, preview)).toBeUndefined();
});
