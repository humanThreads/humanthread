import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("returns service health without requiring database access", async () => {
    const response = await GET();
    const body = (await response.json()) as {
      ok: boolean;
      service: string;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      service: "humanthread-web",
    });
  });
});

