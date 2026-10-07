import { describe, expect, it } from "vitest";

import config from "../../vite.config";

describe("desktop preview Vite config", () => {
  it("exposes the development server on the LAN and proxies official Desktop APIs", () => {
    const resolved = config as {
      server?: {
        host?: string;
        port?: number;
        proxy?: Record<string, unknown>;
      };
    };

    expect(resolved.server?.host).toBe("0.0.0.0");
    expect(resolved.server?.port).toBe(4174);
    expect(resolved.server?.proxy?.["/api"]).toMatchObject({
      target: "http://localhost:3000",
      changeOrigin: true,
      secure: true,
    });
  });
});
