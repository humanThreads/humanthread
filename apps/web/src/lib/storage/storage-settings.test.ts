import { describe, expect, it, vi } from "vitest";
import { getStorageSettings, updateStorageSettings } from "./storage-settings";

describe("storage settings", () => {
  it("reads a redacted platform storage configuration", async () => {
    const findUnique = vi.fn().mockResolvedValue({ value: JSON.stringify({ provider: "s3", bucket: "files", endpoint: "https://s3.example", region: "cn", credentialRef: "secret/s3", scan: "unconfigured" }) });
    await expect(getStorageSettings({ db: { siteSetting: { findUnique } } })).resolves.toEqual(expect.objectContaining({ provider: "s3", credentialRef: "secret/s3", scan: "unconfigured" }));
  });

  it("requires site administrator and stores only validated metadata", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const db = { user: { findUnique: vi.fn().mockResolvedValue({ isSiteAdmin: true }) }, siteSetting: { findUnique: vi.fn(), upsert } };
    await updateStorageSettings({ userId: "user_1", config: { provider: "oss", bucket: "files", endpoint: "https://oss.example", credentialRef: "secret/oss", scan: "unconfigured" }, db });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ key: "storageConfig" }) }));
    expect(JSON.stringify(upsert.mock.calls[0]?.[0])).not.toContain("secret-value");
  });
});
