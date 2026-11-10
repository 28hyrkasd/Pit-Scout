/**
 * RFC 4122 version 4 UUID.
 *
 * crypto.randomUUID() only exists in secure contexts (https or localhost). A scout
 * testing over plain http on the venue LAN would otherwise hit a TypeError at save
 * time, so fall back to getRandomValues(), which is available everywhere.
 *
 * Call from event handlers or effects, never during render (cacheComponents).
 */
export function newUuid(
  cryptoImpl: Pick<Crypto, "getRandomValues"> &
    Partial<Pick<Crypto, "randomUUID">> = globalThis.crypto,
): string {
  if (typeof cryptoImpl.randomUUID === "function")
    return cryptoImpl.randomUUID();

  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
