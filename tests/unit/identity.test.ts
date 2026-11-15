import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecureIdentifier } from '../../src/security/identity';
import { createServerEditor } from '../../src/composition/server';

afterEach(() => vi.unstubAllGlobals());

describe('cryptographic identities without SecureContext-only APIs', () => {
  it('retains all 128 random bits and preserves the crypto receiver', () => {
    const random = {
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        expect(this).toBe(random);
        if (!(array instanceof Uint8Array)) throw new Error('EXPECTED_BYTES');
        array.set(Array.from({ length: 16 }, (_, index) => index));
        return array;
      },
    };
    expect(new SecureIdentifier(random).next()).toBe('000102030405060708090a0b0c0d0e0f');
  });

  it('fails closed if cryptographic randomness is missing or throws', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => new SecureIdentifier().next()).toThrow('CRYPTO_UNAVAILABLE');
    expect(() =>
      new SecureIdentifier({
        getRandomValues() {
          throw new Error('UNAVAILABLE');
        },
      }).next(),
    ).toThrow('CRYPTO_UNAVAILABLE');
  });

  it.each(['page', 'email'] as const)(
    'opens empty %s and creates fresh preview nonces without randomUUID',
    (kind) => {
      const crypto = globalThis.crypto;
      vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
      const first = createServerEditor({ kind, source: { html: '', css: '' } });
      const second = createServerEditor({ kind, source: { html: '', css: '' } });
      try {
        expect(first.session.exportSource()).toEqual({ html: '', css: '' });
        expect(first.session.snapshot().id).not.toBe(second.session.snapshot().id);
        expect(
          first.session.importSource({ html: '<p>Conteúdo preservado</p>', css: 'p{color:teal}' }),
        ).toBe(true);
        const snapshot = first.session.snapshot();
        const before = first.selectionRenderer.build(snapshot, 'Selecionar bloco');
        const after = first.selectionRenderer.build(snapshot, 'Selecionar bloco');
        expect(before.nonce).toMatch(/^[a-f0-9]{32}$/);
        expect(after.nonce).not.toBe(before.nonce);
        expect(before.html).toMatch(/script-src 'sha256-[A-Za-z0-9+/]{43}='/);
        expect(before.html).not.toContain(`'nonce-`);
        expect(before.html).toContain('Conteúdo preservado');
        expect(before.nodeIds.length).toBeGreaterThan(0);
        first.session.setReadOnly(true);
        expect(first.session.importSource({ html: '<p>Outro conteúdo</p>', css: '' })).toBe(false);
        expect(first.session.snapshot()).toEqual(snapshot);
      } finally {
        first.dispose();
        second.dispose();
      }
    },
  );
});
