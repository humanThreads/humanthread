import { describe, expect, it, vi } from "vitest";
import { createStorageDriver, parseStorageConfig, type StorageObject } from "./unified-storage";

const object: StorageObject = { key: "project_1/task_1/file.txt", contentType: "text/plain", body: new Uint8Array([1, 2, 3]) };

describe("unified storage", () => {
  it("accepts local, OSS and S3 drivers without persisting secrets", () => {
    expect(parseStorageConfig({ provider: "local", rootPath: "/srv/files", scan: "unconfigured" })).toEqual({ provider: "local", rootPath: "/srv/files", scan: "unconfigured" });
    expect(parseStorageConfig({ provider: "oss", bucket: "humanthread", endpoint: "https://oss.example", credentialRef: "secret/oss", scan: "configured" })).toMatchObject({ provider: "oss", credentialRef: "secret/oss" });
    expect(parseStorageConfig({ provider: "s3", bucket: "humanthread", endpoint: "https://s3.example", region: "cn", credentialRef: "secret/s3", scan: "unconfigured" })).toMatchObject({ provider: "s3" });
    expect(() => parseStorageConfig({ provider: "oss", bucket: "b", endpoint: "e", accessKeySecret: "raw-secret" })).toThrow("credentialRef");
  });

  it("normalizes object keys and exposes pending_scan when scanning is unconfigured", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const driver = createStorageDriver({ provider: "oss", bucket: "b", endpoint: "https://e", credentialRef: "secret/oss", scan: "unconfigured" }, { objectStore: { put } });
    await expect(driver.put({ ...object, key: "/project_1//task_1/file.txt" })).resolves.toMatchObject({ key: "project_1/task_1/file.txt", scanStatus: "pending_scan" });
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ key: "project_1/task_1/file.txt" }));
  });

  it("returns explicit failures for unsupported objects and failed backends", async () => {
    const driver = createStorageDriver({ provider: "s3", bucket: "b", endpoint: "https://e", region: "cn", credentialRef: "secret/s3", scan: "configured" }, { objectStore: { put: vi.fn().mockRejectedValue(new Error("backend unavailable")) } });
    await expect(driver.put(object)).rejects.toMatchObject({ code: "storage_backend_unavailable" });
  });

  it("supports the complete local object lifecycle", async () => {
    const root = "/tmp/humanthread-storage-test";
    const driver = createStorageDriver({ provider: "local", rootPath: root, scan: "configured" });
    await driver.put(object);
    await expect(driver.exists(object.key)).resolves.toBe(true);
    await expect(driver.metadata(object.key)).resolves.toMatchObject({ key: object.key, byteSize: 3 });
    await expect(driver.get(object.key)).resolves.toMatchObject({ key: object.key, body: new Uint8Array([1, 2, 3]) });
    await expect(driver.signedUrl(object.key)).resolves.toContain("/api/storage/objects/");
    await driver.delete(object.key);
    await expect(driver.exists(object.key)).resolves.toBe(false);
  });

  it("requires every lifecycle operation from remote object stores", async () => {
    const backend = { put: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue(object), delete: vi.fn().mockResolvedValue(undefined), exists: vi.fn().mockResolvedValue(true), metadata: vi.fn().mockResolvedValue({ key: object.key, contentType: object.contentType, byteSize: 3 }), signedUrl: vi.fn().mockResolvedValue("https://signed.example/object") };
    const driver = createStorageDriver({ provider: "s3", bucket: "b", endpoint: "https://e", region: "cn", credentialRef: "secret/s3", scan: "configured" }, { objectStore: backend });
    await expect(driver.get(object.key)).resolves.toEqual(object);
    await expect(driver.exists(object.key)).resolves.toBe(true);
    await expect(driver.metadata(object.key)).resolves.toMatchObject({ byteSize: 3 });
    await expect(driver.signedUrl(object.key, 60)).resolves.toBe("https://signed.example/object");
    await driver.delete(object.key);
    expect(backend.delete).toHaveBeenCalledWith(object.key);
  });
});
