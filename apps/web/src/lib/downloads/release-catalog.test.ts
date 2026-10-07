import { describe, expect, it, vi } from "vitest";

import {
  ReleaseCatalogUnavailableError,
  readReleaseCatalog,
} from "./release-catalog";

const manifest = {
  schemaVersion: 1,
  publishedAt: "2026-08-09T12:00:00.000Z",
  artifacts: {
    "desktop.macos.arm64": {
      version: "1.4.0",
      objectKey: "downloads/desktop/macos/arm64/1.4.0/HumanThread.zip",
      fileName: "HumanThread-1.4.0-macos-arm64.zip",
      size: 1234,
      sha256: "a".repeat(64),
      publishedAt: "2026-08-09T12:00:00.000Z",
    },
  },
};

describe("release catalog", () => {
  it("returns only a strictly validated manifest", async () => {
    const client = {
      get: vi.fn(async () => ({ content: Buffer.from(JSON.stringify(manifest)) })),
    };
    await expect(readReleaseCatalog(client)).resolves.toEqual(manifest);
    expect(client.get).toHaveBeenCalledWith("downloads/releases/latest.json");
  });

  it("maps a missing manifest to an empty catalog", async () => {
    const client = {
      get: vi.fn(async () => {
        throw Object.assign(new Error("missing"), { status: 404 });
      }),
    };
    await expect(readReleaseCatalog(client)).resolves.toEqual({
      schemaVersion: 1,
      publishedAt: null,
      artifacts: {},
    });
  });

  it("fails closed when the manifest is malformed or oversized", async () => {
    await expect(readReleaseCatalog({
      get: vi.fn(async () => ({ content: Buffer.from("{}") })),
    })).rejects.toBeInstanceOf(ReleaseCatalogUnavailableError);
    await expect(readReleaseCatalog({
      get: vi.fn(async () => ({ content: Buffer.alloc(300_000) })),
    })).rejects.toBeInstanceOf(ReleaseCatalogUnavailableError);
  });

  it("fails closed when OSS returns no manifest content", async () => {
    await expect(readReleaseCatalog({
      get: vi.fn(async () => ({})),
    })).rejects.toBeInstanceOf(ReleaseCatalogUnavailableError);
  });
});
