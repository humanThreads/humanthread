import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  shell,
  Tray,
} from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  createCommandHandlers,
  type NativeNotificationInput,
  type TrayMenuState,
} from "./commands";
import { CodexAppServerRegistry } from "./lib/codex-app-server";
import { createCodexTuiBroker } from "./lib/codex-tui-broker";
import { createLiveSessionRuntime } from "./lib/live-session-runtime";
import { prepareCodexTuiViewerHome } from "./lib/codex-tui-viewer-home";
import { ManagedCommandRegistry } from "./lib/processes";
import { LiveSessionJournal } from "@humanthread/live-session-journal";

const APP_PROTOCOL = "humanthread";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let pendingDeepLinks: string[] = [];
let trayState: TrayMenuState = {
  items: [
    { id: "status", label: "正在连接 · 检查设备", enabled: false },
    { id: "current-task", label: "暂无当前任务", enabled: false },
    { id: "toggle-window", label: "隐藏窗口", enabled: true },
    { id: "self-check", label: "运行桌面自检", enabled: true },
    { id: "quit", label: "退出 HumanThread", enabled: true },
  ],
};

function resourcePath(name: string): string {
  return join(__dirname, "..", "build-resources", name);
}

function emitEvent(event: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("humanthread:event", { event, data: payload });
  }
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
  emitEvent("desktop_window_visibility", true);
}

function normalizeDeepLink(value: string): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  return value.startsWith(`${APP_PROTOCOL}://`) ? value : null;
}

function collectDeepLinksFromArgv(argv: string[]): string[] {
  return argv
    .map((argument) => normalizeDeepLink(argument))
    .filter((value): value is string => value !== null);
}

function dispatchDeepLinks(urls: string[]): void {
  const valid = urls
    .map((url) => normalizeDeepLink(url))
    .filter((value): value is string => value !== null);
  if (valid.length === 0) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
    if (mainWindow.webContents.isLoading()) {
      pendingDeepLinks.push(...valid);
    } else {
      mainWindow.webContents.send("humanthread:deep-link", valid);
    }
  } else {
    pendingDeepLinks.push(...valid);
  }
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate(
    trayState.items.map((item) => ({
      id: item.id,
      label: item.label,
      enabled: item.enabled,
      click: () => handleTrayAction(item.id),
    })),
  );
}

function handleTrayAction(id: string): void {
  if (id === "toggle-window") {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
      emitEvent("desktop_window_visibility", false);
    } else {
      showMainWindow();
    }
    return;
  }
  if (id === "current-task") {
    showMainWindow();
    emitEvent("desktop_tray_action", "current-task");
    return;
  }
  if (id === "self-check") {
    showMainWindow();
    emitEvent("desktop_tray_action", "self-check");
    return;
  }
  if (id === "quit") {
    showMainWindow();
    emitEvent("desktop_quit_requested", null);
  }
}

function setupTray(): void {
  const iconPath = resourcePath("trayTemplate.png");
  const icon = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  if (process.platform === "darwin") icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("HumanThread Desktop");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => {
    if (process.platform !== "darwin") handleTrayAction("toggle-window");
  });
}

interface StoreCache {
  document: Record<string, unknown>;
}

const storeCache = new Map<string, StoreCache>();

function storePath(name: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(name)) {
    throw new Error("Native store name is invalid");
  }
  const directory = join(app.getPath("userData"), "stores");
  mkdirSync(directory, { recursive: true });
  return join(directory, name);
}

function loadStoreDocument(name: string): StoreCache {
  const cached = storeCache.get(name);
  if (cached) return cached;
  const path = storePath(name);
  let document: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        document = parsed as Record<string, unknown>;
      }
    } catch {
      document = {};
    }
  }
  const entry: StoreCache = { document };
  storeCache.set(name, entry);
  return entry;
}

function saveStoreDocument(name: string): void {
  const entry = loadStoreDocument(name);
  const path = storePath(name);
  const temporary = join(dirname(path), `.${name}.${process.pid}.tmp`);
  writeFileSync(temporary, JSON.stringify(entry.document, null, 2), "utf8");
  renameSync(temporary, path);
}

function modelFetch(
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
): Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }> {
  return net.fetch(url, {
    method: "GET",
    headers: init.headers,
    signal: init.signal,
  });
}

function registerIpc(): void {
  const managed = new ManagedCommandRegistry();
  const codexServers = new CodexAppServerRegistry({ send: emitEvent });
  const liveSessionJournal = new LiveSessionJournal({
    rootDirectory: join(app.getPath("userData"), "live-session-journal"),
    retentionDays: 30,
  });
  let liveSessions!: ReturnType<typeof createLiveSessionRuntime>;
  const codexTui = createCodexTuiBroker({
    appServer: codexServers,
    executable: "codex",
    viewerHome: prepareCodexTuiViewerHome(app.getPath("userData")),
    emit: emitEvent,
    journal: liveSessionJournal,
    onSessionOutput: async ({ sessionId, bytes }) => {
      await liveSessions.publish({ sessionId, bytes });
    },
  });
  liveSessions = createLiveSessionRuntime({
    broker: codexTui,
    journal: liveSessionJournal,
  });
  const handlers = createCommandHandlers({
    host: {
      send: emitEvent,
      updateTray: (state) => {
        trayState = state;
        tray?.setContextMenu(buildTrayMenu());
      },
      showNotification: async (input: NativeNotificationInput) => {
        if (!Notification.isSupported()) {
          throw new Error("Native notifications are unavailable on this platform");
        }
        const notification = new Notification({ title: input.title, body: input.body });
        notification.on("click", () => {
          if (input.route) {
            showMainWindow();
            emitEvent("desktop_notification_action", input.route);
          }
        });
        notification.show();
      },
      openExternal: async (url) => {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error("External URL is invalid");
        }
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          throw new Error("External URL is not allowed");
        }
        await shell.openExternal(url);
      },
      quitApplication: () => {
        isQuitting = true;
        app.exit(0);
      },
      modelFetch,
    },
    managed,
    codexServers,
    codexTui,
    liveSessions,
  });

  ipcMain.handle("humanthread:command", async (_event, request: { command?: unknown; args?: unknown }) => {
    try {
      const command = typeof request?.command === "string" ? request.command : "";
      const handler = handlers[command];
      if (!handler) {
        return { ok: false, error: `Unknown native command: ${command}` };
      }
      const args = request?.args && typeof request.args === "object" ? (request.args as Record<string, unknown>) : {};
      if (!Number.isSafeInteger(_event.sender.id) || _event.sender.id <= 0) {
        return { ok: false, error: "Desktop window id is invalid" };
      }
      const result = await handler(args, { windowId: _event.sender.id });
      return { ok: true, result: result === undefined ? null : result };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("humanthread:select-directory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "选择项目目录",
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  ipcMain.handle("humanthread:store:get", (_event, request: { name?: unknown; key?: unknown }) => {
    const name = typeof request?.name === "string" ? request.name : "";
    const key = typeof request?.key === "string" ? request.key : "";
    const entry = loadStoreDocument(name);
    return { found: Object.prototype.hasOwnProperty.call(entry.document, key), value: entry.document[key] };
  });

  ipcMain.handle("humanthread:store:set", (_event, request: { name?: unknown; key?: unknown; value?: unknown }) => {
    const name = typeof request?.name === "string" ? request.name : "";
    const key = typeof request?.key === "string" ? request.key : "";
    if (key.length === 0 || key.length > 256) {
      throw new Error("Native store key is invalid");
    }
    const entry = loadStoreDocument(name);
    entry.document[key] = request?.value;
    return null;
  });

  ipcMain.handle("humanthread:store:save", (_event, request: { name?: unknown }) => {
    const name = typeof request?.name === "string" ? request.name : "";
    saveStoreDocument(name);
    return null;
  });

  ipcMain.handle("humanthread:open-external", async (_event, request: { url?: unknown }) => {
    const url = typeof request?.url === "string" ? request.url : "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { ok: false, error: "External URL is not allowed" };
      }
      await shell.openExternal(url);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("humanthread:deep-link:get-current", () => {
    const urls = pendingDeepLinks;
    pendingDeepLinks = [];
    return urls;
  });

  ipcMain.handle("humanthread:notification:supported", () => Notification.isSupported());
}

function smokeExitMs(): number {
  const value = Number(process.env.HUMANTHREAD_DESKTOP_SMOKE_MS ?? "");
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function createWindow(): void {
  const preloadPath = join(__dirname, "preload.cjs");
  const smoke = smokeExitMs() > 0;
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 960,
    minHeight: 720,
    resizable: true,
    title: "HumanThread Desktop",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  mainWindow.once("ready-to-show", () => {
    if (!smoke) mainWindow?.show();
  });
  if (smoke) {
    mainWindow.webContents.once("did-finish-load", () => {
      console.log("[humanthread-smoke] renderer-loaded");
      setTimeout(() => {
        isQuitting = true;
        app.exit(0);
      }, smokeExitMs());
    });
    mainWindow.webContents.once("did-fail-load", (_event, code, description) => {
      console.error(`[humanthread-smoke] renderer-failed ${code} ${description}`);
      isQuitting = true;
      app.exit(1);
    });
  }
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
    emitEvent("desktop_window_visibility", false);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.on("did-finish-load", () => {
    if (pendingDeepLinks.length > 0) {
      const urls = pendingDeepLinks;
      pendingDeepLinks = [];
      mainWindow?.webContents.send("humanthread:deep-link", urls);
    }
  });

  const devServerUrl = process.env.HUMANTHREAD_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, "..", "dist", "index.html"));
  }
}

function registerProtocol(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [resolve(process.argv[1] as string)]);
  } else {
    app.setAsDefaultProtocolClient(APP_PROTOCOL);
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    showMainWindow();
    dispatchDeepLinks(collectDeepLinksFromArgv(argv));
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    dispatchDeepLinks([url]);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showMainWindow();
    }
  });

  app.on("window-all-closed", () => {
    // Tray application: keep running without windows.
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  void app.whenReady().then(() => {
    registerProtocol();
    registerIpc();
    setupTray();
    createWindow();
    dispatchDeepLinks(collectDeepLinksFromArgv(process.argv));
  });
}
