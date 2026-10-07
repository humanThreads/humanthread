export interface NativePersistentStore {
  get<T>(key: string): Promise<T | null | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
}

export interface NativeBridge {
  isNative: true;
  platform: string;
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(
    event: string,
    handler: (event: { payload: T }) => void,
  ): Promise<() => void>;
  selectDirectory(): Promise<string | null>;
  loadStore(name: string): NativePersistentStore;
  openExternal(url: string): Promise<void>;
  getCurrentDeepLinks(): Promise<string[] | null>;
  onOpenUrl(handler: (urls: string[]) => void): Promise<() => void>;
  isNotificationPermissionGranted(): Promise<boolean>;
  requestNotificationPermission(): Promise<"granted" | "denied" | "default">;
}

declare global {
  interface Window {
    humanthreadNative?: NativeBridge;
  }
}

export function getNativeBridge(): NativeBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.humanthreadNative;
  if (!bridge || bridge.isNative !== true) return null;
  return bridge;
}

export function requireNativeBridge(): NativeBridge {
  const bridge = getNativeBridge();
  if (!bridge) {
    throw new Error("本地系统动作仅在桌面客户端中可用。");
  }
  return bridge;
}
