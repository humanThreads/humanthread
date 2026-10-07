import { contextBridge, ipcRenderer } from "electron";

interface NativeCommandEnvelope {
  ok: boolean;
  result?: unknown;
  error?: string;
}

function toError(message: string): Error {
  const match = /^([a-z][a-z0-9_]{2,63}):\s*(.*)$/su.exec(message.trim());
  if (match && match[1] && match[2] !== undefined) {
    return Object.assign(new Error(match[2].trim().slice(0, 512)), { code: match[1] });
  }
  return new Error(message);
}

async function invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  if (typeof command !== "string" || command.length === 0 || command.length > 128) {
    throw new Error("Native command name is invalid");
  }
  const envelope = (await ipcRenderer.invoke("humanthread:command", {
    command,
    args: args ?? {},
  })) as NativeCommandEnvelope;
  if (envelope && envelope.ok) {
    return envelope.result ?? null;
  }
  throw toError(typeof envelope?.error === "string" ? envelope.error : "Native command failed");
}

function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  const listener = (_ipcEvent: unknown, payload: { event: string; data: T }) => {
    if (payload?.event !== event) return;
    handler({ payload: payload.data });
  };
  ipcRenderer.on("humanthread:event", listener);
  return Promise.resolve(() => {
    ipcRenderer.removeListener("humanthread:event", listener);
  });
}

async function selectDirectory(): Promise<string | null> {
  const selected = (await ipcRenderer.invoke("humanthread:select-directory")) as unknown;
  if (typeof selected === "string" && selected.length > 0) return selected;
  return null;
}

function loadStore(name: string): {
  get<T>(key: string): Promise<T | null | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
} {
  return {
    async get<T>(key: string): Promise<T | null | undefined> {
      const value = (await ipcRenderer.invoke("humanthread:store:get", { name, key })) as
        | { found: boolean; value: unknown };
      if (!value || !value.found) return null;
      return value.value as T;
    },
    async set(key: string, value: unknown): Promise<void> {
      await ipcRenderer.invoke("humanthread:store:set", { name, key, value });
    },
    async save(): Promise<void> {
      await ipcRenderer.invoke("humanthread:store:save", { name });
    },
  };
}

async function openExternal(url: string): Promise<void> {
  const envelope = (await ipcRenderer.invoke("humanthread:open-external", { url })) as NativeCommandEnvelope;
  if (!envelope || !envelope.ok) {
    throw toError(typeof envelope?.error === "string" ? envelope.error : "Failed to open external URL");
  }
}

async function getCurrentDeepLinks(): Promise<string[] | null> {
  const urls = (await ipcRenderer.invoke("humanthread:deep-link:get-current")) as unknown;
  if (!Array.isArray(urls) || urls.length === 0) return null;
  return urls.filter((url): url is string => typeof url === "string");
}

async function onOpenUrl(handler: (urls: string[]) => void): Promise<() => void> {
  const listener = (_ipcEvent: unknown, urls: string[]) => {
    if (Array.isArray(urls) && urls.length > 0) handler(urls);
  };
  ipcRenderer.on("humanthread:deep-link", listener);
  return () => {
    ipcRenderer.removeListener("humanthread:deep-link", listener);
  };
}

async function isPermissionGranted(): Promise<boolean> {
  return (await ipcRenderer.invoke("humanthread:notification:supported")) as boolean;
}

async function requestPermission(): Promise<"granted" | "denied" | "default"> {
  const granted = (await ipcRenderer.invoke("humanthread:notification:supported")) as boolean;
  return granted ? "granted" : "denied";
}

export interface HumanThreadNativeBridge {
  isNative: true;
  platform: string;
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void>;
  selectDirectory(): Promise<string | null>;
  loadStore(name: string): ReturnType<typeof loadStore>;
  openExternal(url: string): Promise<void>;
  getCurrentDeepLinks(): Promise<string[] | null>;
  onOpenUrl(handler: (urls: string[]) => void): Promise<() => void>;
  isNotificationPermissionGranted(): Promise<boolean>;
  requestNotificationPermission(): Promise<"granted" | "denied" | "default">;
}

const bridge: HumanThreadNativeBridge = {
  isNative: true,
  platform: process.platform,
  invoke,
  listen,
  selectDirectory,
  loadStore,
  openExternal,
  getCurrentDeepLinks,
  onOpenUrl,
  isNotificationPermissionGranted: isPermissionGranted,
  requestNotificationPermission: requestPermission,
};

contextBridge.exposeInMainWorld("humanthreadNative", bridge);
