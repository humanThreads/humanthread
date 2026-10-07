import type { ZodType } from "zod";
import { beforeEach, expect, it, vi, type Mock } from "vitest";

export function testDesktopReadRoute(input: {
  name: string;
  url: string;
  get: (request: Request) => Promise<Response>;
  read: Mock;
  data: unknown;
  schema: ZodType;
}) {
  beforeEach(() => vi.clearAllMocks());

  it(`${input.name} returns 401 without an authenticated actor`, async () => {
    input.read.mockRejectedValue(new Error("Workbench API authentication required"));

    const response = await input.get(new Request(input.url));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      code: "authentication_required",
      error: "Workbench API authentication required",
    });
  });

  it(`${input.name} returns 403 for an inaccessible Space`, async () => {
    input.read.mockRejectedValue(new Error("Space access denied"));
    const url = new URL(input.url);
    url.searchParams.set("space", "company:other");

    const response = await input.get(new Request(url));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      code: "authorization_denied",
      error: "Space access denied",
    });
  });

  it(`${input.name} returns its runtime-valid minimum DTO`, async () => {
    input.read.mockResolvedValue(input.data);
    expect(input.schema.safeParse({ ok: true, data: input.data }).success).toBe(true);

    const response = await input.get(new Request(input.url));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(input.schema.parse(body)).toEqual({ ok: true, data: input.data });
  });
}
