"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// electron/preload.ts
var preload_exports = {};
module.exports = __toCommonJS(preload_exports);
var import_electron = require("electron");
function toError(message) {
  const match = /^([a-z][a-z0-9_]{2,63}):\s*(.*)$/su.exec(message.trim());
  if (match && match[1] && match[2] !== void 0) {
    return Object.assign(new Error(match[2].trim().slice(0, 512)), { code: match[1] });
  }
  return new Error(message);
}
async function invoke(command, args) {
  if (typeof command !== "string" || command.length === 0 || command.length > 128) {
    throw new Error("Native command name is invalid");
  }
  const envelope = await import_electron.ipcRenderer.invoke("humanthread:command", {
    command,
    args: args ?? {}
  });
  if (envelope && envelope.ok) {
    return envelope.result ?? null;
  }
  throw toError(typeof envelope?.error === "string" ? envelope.error : "Native command failed");
}
function listen(event, handler) {
  const listener = (_ipcEvent, payload) => {
    if (payload?.event !== event) return;
    handler({ payload: payload.data });
  };
  import_electron.ipcRenderer.on("humanthread:event", listener);
  return Promise.resolve(() => {
    import_electron.ipcRenderer.removeListener("humanthread:event", listener);
  });
}
async function selectDirectory() {
  const selected = await import_electron.ipcRenderer.invoke("humanthread:select-directory");
  if (typeof selected === "string" && selected.length > 0) return selected;
  return null;
}
function loadStore(name) {
  return {
    async get(key) {
      const value = await import_electron.ipcRenderer.invoke("humanthread:store:get", { name, key });
      if (!value || !value.found) return null;
      return value.value;
    },
    async set(key, value) {
      await import_electron.ipcRenderer.invoke("humanthread:store:set", { name, key, value });
    },
    async save() {
      await import_electron.ipcRenderer.invoke("humanthread:store:save", { name });
    }
  };
}
async function openExternal(url) {
  const envelope = await import_electron.ipcRenderer.invoke("humanthread:open-external", { url });
  if (!envelope || !envelope.ok) {
    throw toError(typeof envelope?.error === "string" ? envelope.error : "Failed to open external URL");
  }
}
async function getCurrentDeepLinks() {
  const urls = await import_electron.ipcRenderer.invoke("humanthread:deep-link:get-current");
  if (!Array.isArray(urls) || urls.length === 0) return null;
  return urls.filter((url) => typeof url === "string");
}
async function onOpenUrl(handler) {
  const listener = (_ipcEvent, urls) => {
    if (Array.isArray(urls) && urls.length > 0) handler(urls);
  };
  import_electron.ipcRenderer.on("humanthread:deep-link", listener);
  return () => {
    import_electron.ipcRenderer.removeListener("humanthread:deep-link", listener);
  };
}
async function isPermissionGranted() {
  return await import_electron.ipcRenderer.invoke("humanthread:notification:supported");
}
async function requestPermission() {
  const granted = await import_electron.ipcRenderer.invoke("humanthread:notification:supported");
  return granted ? "granted" : "denied";
}
var bridge = {
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
  requestNotificationPermission: requestPermission
};
import_electron.contextBridge.exposeInMainWorld("humanthreadNative", bridge);
