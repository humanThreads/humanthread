import { beforeEach, describe, expect, it, vi } from "vitest";

const requireWorkbenchSession = vi.hoisted(() => vi.fn());
const readReleaseCatalog = vi.hoisted(() => vi.fn());
const signatureUrl = vi.hoisted(() => vi.fn(() => "https://signed.example/HumanThread.zip"));

vi.mock("../../../../lib/workbench/workbench-route-auth", () => ({ requireWorkbenchSession }));
vi.mock("../../../../lib/downloads/release-catalog", () => ({ readReleaseCatalog }));
vi.mock("../../../../lib/downloads/oss-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/downloads/oss-client")>();
  return {
    ...actual,
    createOssClient: vi.fn(() => ({ signatureUrl })),
    readOssDownloadConfig: vi.fn(() => ({ downloadTtlSeconds: 60 })),
  };
});

import { resetDownloadRateLimitForTests } from "../../../../lib/downloads/download-rate-limit";
import { GET } from "./route";

const entry = {
  version: "1.4.0",
  objectKey: "downloads/desktop/macos/arm64/1.4.0/HumanThread.zip",
  fileName: "HumanThread-1.4.0-macos-arm64.zip",
  size: 1234,
  sha256: "a".repeat(64),
  publishedAt: "2026-08-09T12:00:00.000Z",
};

describe("GET /downloads/artifacts/[...artifact]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDownloadRateLimitForTests();
    vi.stubEnv("HUMANTHREAD_DOWNLOAD_RATE_LIMIT_MAX", "5");
    vi.stubEnv("HUMANTHREAD_DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS", "60");
    requireWorkbenchSession.mockResolvedValue({ session: { context: { userId: "user_1" } } });
    readReleaseCatalog.mockResolvedValue({ schemaVersion: 1, publishedAt: entry.publishedAt, artifacts: {
      "desktop.macos.arm64": entry,
    } });
  });

  it("requires a Workbench session before signing", async () => {
    const response = await GET(
      new Request("http://localhost:3000/downloads/artifacts/desktop/macos/arm64"),
      { params: Promise.resolve({ artifact: ["desktop", "macos", "arm64"] }) },
    );
    expect(response.status).toBe(302);
    expect(requireWorkbenchSession).toHaveBeenCalledWith(
      "/downloads/artifacts/desktop/macos/arm64",
    );
  });

  it("rejects unknown and unpublished artifact paths", async () => {
    expect((await GET(new Request("http://localhost:3000/downloads/artifacts/nope"), {
      params: Promise.resolve({ artifact: ["nope"] }),
    })).status).toBe(404);
    expect((await GET(new Request("http://localhost:3000/downloads/artifacts/mobile/android"), {
      params: Promise.resolve({ artifact: ["mobile", "android"] }),
    })).status).toBe(404);
    expect(signatureUrl).not.toHaveBeenCalled();
  });

  it("signs the catalog object with bounded response headers", async () => {
    const response = await GET(
      new Request("http://localhost:3000/downloads/artifacts/desktop/macos/arm64", {
        headers: { "x-forwarded-for": "203.0.113.10", "user-agent": "Browser" },
      }),
      { params: Promise.resolve({ artifact: ["desktop", "macos", "arm64"] }) },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://signed.example/HumanThread.zip");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(signatureUrl).toHaveBeenCalledWith(entry.objectKey, expect.objectContaining({
      expires: 60,
      method: "GET",
      response: expect.objectContaining({
        "content-disposition": `attachment; filename="${entry.fileName}"`,
      }),
    }));
  });
});
