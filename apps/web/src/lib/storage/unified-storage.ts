import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type StorageProvider = "local" | "oss" | "s3";
export type StorageScanStatus = "configured" | "unconfigured";
export type StorageConfig = { provider: StorageProvider; rootPath?: string; bucket?: string; endpoint?: string; region?: string; credentialRef?: string; scan: StorageScanStatus };
export type StorageObject = { key: string; contentType: string; body: Uint8Array };
export type StoragePutResult = { key: string; provider: StorageProvider; scanStatus: "passed" | "pending_scan" };
export type StorageMetadata = { key: string; contentType: string; byteSize: number; etag?: string; lastModified?: Date };
export type StorageDriver = { put(object: StorageObject): Promise<StoragePutResult>; get(key: string): Promise<StorageObject>; delete(key: string): Promise<void>; exists(key: string): Promise<boolean>; metadata(key: string): Promise<StorageMetadata>; signedUrl(key: string, expiresInSeconds?: number): Promise<string> };
type ObjectStore = { put(input: StorageObject): Promise<void | StoragePutResult>; get(key: string): Promise<StorageObject>; delete(key: string): Promise<void>; exists(key: string): Promise<boolean>; metadata(key: string): Promise<StorageMetadata>; signedUrl(key: string, expiresInSeconds?: number): Promise<string> };

export function parseStorageConfig(input: unknown): StorageConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("storage config must be an object");
  const value = input as Record<string, unknown>;
  const provider = value.provider;
  if (provider !== "local" && provider !== "oss" && provider !== "s3") throw new Error("provider is invalid");
  const scan = value.scan === undefined ? "unconfigured" : value.scan;
  if (scan !== "configured" && scan !== "unconfigured") throw new Error("scan is invalid");
  const credentialRef = value.credentialRef;
  if (value.accessKeySecret !== undefined || value.secretAccessKey !== undefined || value.token !== undefined) throw new Error("credentialRef is required; raw credentials are not allowed");
  if (credentialRef !== undefined && (typeof credentialRef !== "string" || !credentialRef.trim())) throw new Error("credentialRef is invalid");
  const stringField = (name: string) => value[name] === undefined ? undefined : typeof value[name] === "string" && value[name].trim() ? value[name].trim() : (() => { throw new Error(`${name} is invalid`); })();
  const config = { provider, ...(provider === "local" ? { rootPath: stringField("rootPath") } : { bucket: stringField("bucket"), endpoint: stringField("endpoint"), ...(provider === "s3" ? { region: stringField("region") } : {}) }), ...(credentialRef === undefined ? {} : { credentialRef: credentialRef.trim() }), scan } as StorageConfig;
  if (provider !== "local" && (!config.bucket || !config.endpoint || !config.credentialRef)) throw new Error("object storage requires bucket, endpoint and credentialRef");
  if (provider === "local" && !config.rootPath) throw new Error("local storage requires rootPath");
  return config;
}

export function createStorageDriver(configInput: unknown, dependencies: { objectStore?: Partial<ObjectStore> } = {}): StorageDriver {
  const config = parseStorageConfig(configInput);
  const localPath = (key: string) => join(config.rootPath!, normalizeStorageKey(key));
  const backend = dependencies.objectStore;
  const requireBackend = <K extends keyof ObjectStore>(method: K) => {
    const fn = backend?.[method];
    if (!fn) throw Object.assign(new Error("storage backend unavailable"), { code: "storage_backend_unavailable" });
    return fn as ObjectStore[K];
  };
  return {
    async put(object: StorageObject): Promise<StoragePutResult> {
      const key = normalizeStorageKey(object.key);
      if (!key || object.body.byteLength === 0) throw Object.assign(new Error("storage object is empty"), { code: "storage_object_invalid" });
      try {
        if (config.provider === "local") {
          await mkdir(dirname(localPath(key)), { recursive: true });
          await writeFile(localPath(key), object.body);
        } else await requireBackend("put")({ ...object, key });
      } catch { throw Object.assign(new Error("storage backend unavailable"), { code: "storage_backend_unavailable" }); }
      return { key, provider: config.provider, scanStatus: config.scan === "configured" ? "passed" : "pending_scan" };
    },
    async get(rawKey: string) {
      const key = normalizeStorageKey(rawKey);
      try { if (config.provider === "local") return { key, contentType: "application/octet-stream", body: new Uint8Array(await readFile(localPath(key))) }; return await requireBackend("get")(key); }
      catch { throw Object.assign(new Error("storage backend unavailable"), { code: "storage_backend_unavailable" }); }
    },
    async delete(rawKey: string) {
      const key = normalizeStorageKey(rawKey);
      try { if (config.provider === "local") await rm(localPath(key), { force: true }); else await requireBackend("delete")(key); }
      catch { throw Object.assign(new Error("storage backend unavailable"), { code: "storage_backend_unavailable" }); }
    },
    async exists(rawKey: string) {
      const key = normalizeStorageKey(rawKey);
      try { if (config.provider === "local") { await stat(localPath(key)); return true; } return await requireBackend("exists")(key); }
      catch (error) { if (config.provider === "local" && (error as NodeJS.ErrnoException).code === "ENOENT") return false; throw Object.assign(new Error("storage backend unavailable"), { code: "storage_backend_unavailable" }); }
    },
    async metadata(rawKey: string) {
      const key = normalizeStorageKey(rawKey);
      try { if (config.provider === "local") { const info = await stat(localPath(key)); return { key, contentType: "application/octet-stream", byteSize: info.size, lastModified: info.mtime }; } return await requireBackend("metadata")(key); }
      catch { throw Object.assign(new Error("storage backend unavailable"), { code: "storage_backend_unavailable" }); }
    },
    async signedUrl(rawKey: string, expiresInSeconds = 900) {
      const key = normalizeStorageKey(rawKey);
      if (config.provider === "local") return "/api/storage/objects/" + encodeURIComponent(key);
      try { return await requireBackend("signedUrl")(key, expiresInSeconds); }
      catch { throw Object.assign(new Error("storage backend unavailable"), { code: "storage_backend_unavailable" }); }
    },
  };
}

export function normalizeStorageKey(key: string) {
  return key.split("/").filter(Boolean).join("/").replace(/^\//u, "");
}
