import { describe, expect, it } from "vitest";

import {
  consumeDownloadRateLimit,
  normalizeDownloadClientKey,
  readDownloadRateLimitConfig,
} from "./download-rate-limit";

describe("download rate limit", () => {
  it("reads bounded defaults and rejects unsafe values", () => {
    expect(readDownloadRateLimitConfig({})).toEqual({ maxRequests: 5, windowMs: 60000 });
    expect(() => readDownloadRateLimitConfig({ HUMANTHREAD_DOWNLOAD_RATE_LIMIT_MAX: "0" }))
      .toThrow();
  });

  it("allows the configured number then returns a retry window", () => {
    const config = { maxRequests: 2, windowMs: 10000 };

    expect(consumeDownloadRateLimit("client", config, 1000).allowed).toBe(true);
    expect(consumeDownloadRateLimit("client", config, 1001).allowed).toBe(true);
    const limited = consumeDownloadRateLimit("client", config, 1002);

    expect(limited.allowed).toBe(false);
    expect(limited.retryAfterSeconds).toBe(10);
  });

  it("uses the proxy IP and coarse platform family without retaining the full user agent", () => {
    const request = new Request("http://localhost:3000/downloads/local-agent/macos", {
      headers: {
        "x-forwarded-for": "203.0.113.20, 10.0.0.2",
        "user-agent": "HumanThread Local Agent macOS secret-build-marker",
      },
    });

    expect(normalizeDownloadClientKey(request)).toBe("203.0.113.20:mac");
  });
});
