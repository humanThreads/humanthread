import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    set: vi.fn(),
  }),
}));

vi.mock("../../../../lib/workbench/workbench-login-session", () => ({
  createWorkbenchLoginSession: vi.fn().mockResolvedValue({
    email: "alice@example.com",
    webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  }),
}));

describe("POST /api/workbench/login", () => {
  it("logs in with account credentials and returns the authenticated email", async () => {
    const { cookies } = await import("next/headers");
    const { createWorkbenchLoginSession } = await import(
      "../../../../lib/workbench/workbench-login-session"
    );
    const cookieStore = {
      set: vi.fn(),
    };
    vi.mocked(cookies).mockResolvedValueOnce(
      cookieStore as unknown as Awaited<ReturnType<typeof cookies>>,
    );

    const response = await POST(
      new Request("http://localhost:3000/api/workbench/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "alice@example.com",
          password: "correct-password",
        }),
      }),
    );
    const body = (await response.json()) as {
      ok: boolean;
      email: string;
    };

    expect(response.status).toBe(200);
    expect(createWorkbenchLoginSession).toHaveBeenCalledWith({
      email: "alice@example.com",
      password: "correct-password",
      cookieStore,
      request: expect.any(Request),
    });
    expect(body).toEqual({
      ok: true,
      email: "alice@example.com",
    });
  });

  it("returns 401 when credentials are invalid", async () => {
    const { createWorkbenchLoginSession } = await import(
      "../../../../lib/workbench/workbench-login-session"
    );
    vi.mocked(createWorkbenchLoginSession).mockRejectedValueOnce(
      new Error("Workbench login credentials are invalid"),
    );

    const response = await POST(
      new Request("http://localhost:3000/api/workbench/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "alice@example.com",
          password: "wrong-password",
        }),
      }),
    );
    const body = (await response.json()) as {
      ok: boolean;
      error: string;
    };

    expect(response.status).toBe(401);
    expect(body).toEqual({
      ok: false,
      error: "Workbench login credentials are invalid",
    });
  });
});
