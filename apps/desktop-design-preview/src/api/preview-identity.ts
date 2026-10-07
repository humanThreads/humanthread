export type PreviewPlatform = "macos" | "windows" | "linux";

export interface PreviewIdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PreviewIdentity {
  installationId: string;
  deviceId: string;
  deviceName: string;
  platform: PreviewPlatform;
}

export const PREVIEW_IDENTITY_STORAGE_KEY = "humanthread.desktop-preview.identity.v1";

function randomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

export function previewPlatform(value: string): PreviewPlatform {
  const normalized = value.toLowerCase();
  if (normalized.includes("win")) return "windows";
  if (normalized.includes("linux")) return "linux";
  return "macos";
}

function parseStoredIdentity(value: string | null): PreviewIdentity | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PreviewIdentity>;
    if (
      typeof parsed.installationId !== "string"
      || typeof parsed.deviceId !== "string"
      || typeof parsed.deviceName !== "string"
      || (parsed.platform !== "macos" && parsed.platform !== "windows" && parsed.platform !== "linux")
    ) {
      return null;
    }
    return {
      installationId: parsed.installationId,
      deviceId: parsed.deviceId,
      deviceName: parsed.deviceName,
      platform: parsed.platform,
    };
  } catch {
    return null;
  }
}

export function resolvePreviewIdentity(
  storage: PreviewIdentityStorage,
  platformHint = typeof navigator === "undefined" ? "linux" : navigator.platform,
): PreviewIdentity {
  const stored = parseStoredIdentity(storage.getItem(PREVIEW_IDENTITY_STORAGE_KEY));
  if (stored) return stored;

  const platform = previewPlatform(platformHint);
  const deviceSuffix = randomHex(24);
  const identity: PreviewIdentity = {
    installationId: `desktop-design-preview-${randomHex(24)}`,
    deviceId: `desktop-preview-${deviceSuffix}`,
    deviceName: `Design Preview · ${platform}`,
    platform,
  };
  storage.setItem(PREVIEW_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  return identity;
}
