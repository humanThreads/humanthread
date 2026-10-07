import { beforeEach, describe, expect, it, vi } from "vitest";

const artifactGet = vi.hoisted(() => vi.fn());

vi.mock("../../artifacts/[...artifact]/route", () => ({ GET: artifactGet }));

describe("GET /downloads/local-agent/macos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    artifactGet.mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "https://signed.example/HumanThread.dmg" },
    }));
  });

  it("delegates to the authenticated macOS arm64 release route", async () => {
    const route = await import("./route");
    const request = new Request("http://localhost:3000/downloads/local-agent/macos");

    const response = await route.GET(request);

    expect(response.status).toBe(302);
    expect(artifactGet).toHaveBeenCalledWith(request, {
      params: expect.any(Promise),
    });
    await expect(artifactGet.mock.calls[0]?.[1].params).resolves.toEqual({
      artifact: ["desktop", "macos", "arm64"],
    });
  });

  it("preserves an unpublished response from the stable route", async () => {
    artifactGet.mockResolvedValue(new Response("Download not published", {
      status: 404,
      headers: { "cache-control": "no-store" },
    }));
    const route = await import("./route");

    const response = await route.GET(new Request("http://localhost:3000/downloads/local-agent/macos"));

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
