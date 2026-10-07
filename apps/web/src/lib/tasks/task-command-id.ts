const HEX = "0123456789abcdef";

/** Generates a bounded idempotency key for browser-originated Task commands. */
export function createTaskCommandId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.replaceAll("-", "").toLowerCase();

  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => `${HEX[byte >>> 4]}${HEX[byte & 0x0f]}`).join("");
}
