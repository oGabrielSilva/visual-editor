import { describe, expect, it } from 'vitest';
import { ImageRequestService } from '../../../src/vue/services/image-requests';
import type {
  EditorImagePicker,
  ImageRequestPorts,
} from '../../../src/vue/services/image-requests';
import { editor, regionId } from './support';

const setup = (picker?: EditorImagePicker, legacy?: (nodeId: string | undefined) => void) => {
  const instance = editor();
  const events: string[] = [];
  const ports: ImageRequestPorts = {
    controller: () => instance.controller,
    picker: () => picker,
    legacyRequest: () => legacy,
    flush: async () => true,
    notify: (outcome) => events.push(outcome),
  };
  return { instance, events, images: new ImageRequestService(ports) };
};
const html = (instance: ReturnType<typeof editor>): string =>
  instance.controller.state().source.html;

describe('ImageRequestService: one path for every way of choosing an image', () => {
  it('asks the picker of the host with the current image and applies its answer', async () => {
    const requests: unknown[] = [];
    const { instance, images, events } = setup({
      pickImage: async (request) => {
        requests.push(request);
        return { id: 'asset-1', url: 'https://example.test/novo.png', alt: 'Nova' };
      },
    });
    const image = regionId(instance, 'img');
    expect(await images.choose(image)).toBe(true);
    expect(requests).toEqual([
      { nodeId: image, kind: 'page', current: { url: 'https://example.test/a.png', alt: 'Foto' } },
    ]);
    expect(html(instance)).toContain('src="https://example.test/novo.png"');
    expect(html(instance)).toContain('data-host-asset-id="asset-1"');
    expect(events).toEqual(['applied']);
    expect(images.busy.value).toBe(false);
  });

  it('changes nothing when the person gives up or the host fails', async () => {
    const before = html(setup().instance);
    const gaveUp = setup({ pickImage: async () => undefined });
    expect(await gaveUp.images.choose(regionId(gaveUp.instance, 'img'))).toBe(false);
    expect(html(gaveUp.instance)).toBe(before);
    expect(gaveUp.events).toEqual([]);
    const failed = setup({
      pickImage: async () => {
        throw new Error('network');
      },
    });
    expect(await failed.images.choose(regionId(failed.instance, 'img'))).toBe(false);
    expect(failed.events).toEqual(['invalid']);
    expect(failed.images.busy.value).toBe(false);
  });

  it('refuses an unsafe address or a malformed asset id from the host', async () => {
    for (const choice of [
      { id: 'asset-1', url: 'javascript:alert(1)' },
      { id: 'asset-1', url: 'data:image/svg+xml,<svg onload=alert(1)>' },
      { id: 'bad id!', url: 'https://example.test/x.png' },
    ]) {
      const { instance, images, events } = setup({ pickImage: async () => choice });
      const before = html(instance);
      expect(await images.choose(regionId(instance, 'img'))).toBe(false);
      expect(html(instance)).toBe(before);
      expect(events).toEqual(['invalid']);
    }
  });

  it('falls back to the older request event, then to its own dialog with a URL', async () => {
    const asked: (string | undefined)[] = [];
    const legacy = setup(undefined, (nodeId) => asked.push(nodeId));
    const image = regionId(legacy.instance, 'img');
    expect(await legacy.images.choose(image)).toBe(true);
    expect(asked).toEqual([image]);
    expect(legacy.images.dialog.value).toBeUndefined();

    const own = setup();
    const target = regionId(own.instance, 'img');
    await own.images.choose(target);
    expect(own.images.dialog.value).toEqual({
      nodeId: target,
      url: 'https://example.test/a.png',
      alt: 'Foto',
    });
    expect(own.images.apply({ url: 'ftp://example.test/x.png' }, target)).toBe(false);
    expect(own.images.dialog.value).toBeDefined();
    expect(own.images.apply({ url: 'https://example.test/b.png', alt: 'Outra' }, target)).toBe(
      true,
    );
    expect(html(own.instance)).toContain('src="https://example.test/b.png"');
    expect(html(own.instance)).toContain('alt="Outra"');
    expect(html(own.instance)).not.toContain('data-host-asset-id');
    expect(own.images.dialog.value).toBeUndefined();
  });

  it('inserts an image the host answered without an asset id, where it was dropped', async () => {
    const file = new File(['x'], 'foto.png', { type: 'image/png' });
    const { instance, images, events } = setup({
      pickImage: async () => ({ url: 'https://example.test/escolhida.png', alt: 'Escolhida "A"' }),
      uploadImage: async () => ({ url: 'https://example.test/solta.png' }),
    });
    const revision = instance.controller.state().document.revision;
    expect(await images.choose()).toBe(true);
    expect(html(instance)).toContain(
      '<img src="https://example.test/escolhida.png" alt="Escolhida &quot;A&quot;"',
    );
    expect(html(instance)).not.toContain('data-host-asset-id');
    expect(instance.controller.state().document.revision).toBe(revision + 1);
    expect(
      await images.upload(file, { targetId: regionId(instance, 'h2'), placement: 'before' }),
    ).toBe(true);
    expect(html(instance).indexOf('solta.png')).toBeLessThan(html(instance).indexOf('<h2'));
    expect(await images.upload(file, 'end')).toBe(true);
    expect(html(instance).lastIndexOf('solta.png')).toBeGreaterThan(html(instance).indexOf('Foto'));
    expect(events).toEqual(['applied', 'applied', 'applied']);
    // Each insertion is one step.
    expect(instance.controller.undo()).toBe(true);
    expect(instance.controller.undo()).toBe(true);
    expect(instance.controller.undo()).toBe(true);
    expect(html(instance)).not.toContain('solta.png');
    expect(html(instance)).not.toContain('escolhida.png');
    // An unsafe address is refused in the same way as with an id.
    const unsafe = setup({ pickImage: async () => ({ url: 'javascript:alert(1)' }) });
    const before = html(unsafe.instance);
    expect(await unsafe.images.choose()).toBe(false);
    expect(html(unsafe.instance)).toBe(before);
  });

  it('replaces address and description of an image in one history step', () => {
    const instance = editor();
    const renderer = instance.selectionRenderer;
    const events: string[] = [];
    const images = new ImageRequestService({
      controller: () => instance.controller,
      picker: () => undefined,
      legacyRequest: () => undefined,
      flush: async () => true,
      notify: (outcome) => events.push(outcome),
      replaceElementSource: (id, markup) =>
        renderer.replaceElementSource(instance.controller.state().document, id, markup),
    });
    const before = html(instance);
    const image = regionId(instance, 'img');
    const revision = instance.controller.state().document.revision;
    expect(images.apply({ url: 'https://example.test/b.png?a=1&b=2', alt: 'Outra' }, image)).toBe(
      true,
    );
    expect(html(instance)).toContain('src="https://example.test/b.png?a=1&amp;b=2"');
    expect(html(instance)).toContain('alt="Outra"');
    expect(instance.controller.state().document.revision).toBe(revision + 1);
    // The image keeps its identity, so it stays the selected block.
    expect(regionId(instance, 'img')).toBe(image);
    expect(instance.controller.undo()).toBe(true);
    expect(html(instance)).toBe(before);
    expect(instance.controller.state().canUndo).toBe(false);
    // One attribute alone is still one plain command.
    expect(images.apply({ url: 'https://example.test/a.png', alt: 'Nova descrição' }, image)).toBe(
      true,
    );
    expect(html(instance)).toContain('alt="Nova descrição"');
    expect(instance.controller.undo()).toBe(true);
    expect(html(instance)).toBe(before);
  });

  it('uploads a dropped image only when the host declared the upload', async () => {
    const file = new File(['x'], 'foto.png', { type: 'image/png' });
    const without = setup({ pickImage: async () => undefined });
    expect(without.images.acceptsFiles).toBe(false);
    expect(await without.images.upload(file, 'end')).toBe(false);
    const { instance, images } = setup({
      pickImage: async () => undefined,
      uploadImage: async (received) => ({
        id: 'upload-1',
        url: 'https://example.test/upload.png',
        alt: received.name,
      }),
    });
    expect(images.acceptsFiles).toBe(true);
    expect(await images.upload(new File(['x'], 'nota.txt', { type: 'text/plain' }), 'end')).toBe(
      false,
    );
    expect(
      await images.upload(file, { targetId: regionId(instance, 'p'), placement: 'after' }),
    ).toBe(true);
    expect(html(instance)).toContain('data-host-asset-id="upload-1"');
  });
  it('replaces the image a file was dropped on, through the upload of the host', async () => {
    const requests: unknown[] = [];
    const { instance, images } = setup({
      pickImage: async () => undefined,
      uploadImage: async (received, request) => {
        requests.push(request);
        return { id: 'upload-2', url: 'https://example.test/nova.png', alt: received.name };
      },
    });
    const image = regionId(instance, 'img');
    const before = html(instance);
    const file = new File(['x'], 'nova.png', { type: 'image/png' });
    expect(await images.upload(file, { replace: image })).toBe(true);
    expect(requests).toEqual([
      expect.objectContaining({
        nodeId: image,
        current: { url: 'https://example.test/a.png', alt: 'Foto' },
      }),
    ]);
    const after = html(instance);
    expect(after).toContain('data-host-asset-id="upload-2"');
    expect(after).not.toContain('https://example.test/a.png');
    expect(after.match(/<img/g)).toHaveLength(1);
    expect(instance.controller.undo()).toBe(true);
    expect(html(instance)).toBe(before);
    // Over something which is not an image, the drop is not a replacement.
    expect(await images.upload(file, { replace: regionId(instance, 'p') })).toBe(false);
    expect(html(instance)).toBe(before);
  });
});
