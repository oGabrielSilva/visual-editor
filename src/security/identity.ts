/** Cryptographic opaque identifiers, including nonces for the trusted preview bridge. */
export class SecureIdentifier {
  constructor(
    private readonly random: Pick<Crypto, 'getRandomValues'> | undefined = globalThis.crypto,
  ) {}

  next(): string {
    if (typeof this.random?.getRandomValues !== 'function') throw new Error('CRYPTO_UNAVAILABLE');
    const bytes = new Uint8Array(16);
    try {
      this.random.getRandomValues(bytes);
    } catch {
      throw new Error('CRYPTO_UNAVAILABLE');
    }
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}
