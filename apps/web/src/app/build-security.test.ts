import { describe, expect, it } from "vitest";
import nextConfig, { CLIENT_BUNDLE_PROTECTION_NOTE } from "../../next.config";

describe("web production build security", () => {
  it("keeps browser source maps disabled and removes console output", () => {
    expect(nextConfig.productionBrowserSourceMaps).toBe(false);
    expect(nextConfig.compiler).toMatchObject({
      removeConsole: true,
    });
  });

  it("documents that bundle protection is defense-in-depth rather than secrecy", () => {
    expect(CLIENT_BUNDLE_PROTECTION_NOTE).toContain("不能替代服务端鉴权");
  });

  it("enables strong local cache headers for uploaded avatars", async () => {
    const headers = await nextConfig.headers?.();

    expect(headers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "/uploads/avatars/:path*",
          headers: expect.arrayContaining([
            {
              key: "Cache-Control",
              value: "public, max-age=31536000, immutable",
            },
          ]),
        }),
      ]),
    );
  });
});
