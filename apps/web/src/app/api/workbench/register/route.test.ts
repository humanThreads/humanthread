import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    set: vi.fn(),
  }),
}));

vi.mock("../../../../lib/workbench/workbench-registration", () => ({
  createWorkbenchRegistrationVerification: vi.fn().mockResolvedValue({
    email: "alice@example.com",
    expiresAt: new Date("2026-05-20T10:30:00.000Z"),
  }),
  registerWorkbenchUser: vi.fn().mockResolvedValue({
    userId: "user_1",
    email: "alice@example.com",
    name: "Alice",
    personalProjectId: "project_user_1_personal",
  }),
}));

describe("POST /api/workbench/register", () => {
  it("registers an account and returns the personal workspace", async () => {
    const { cookies } = await import("next/headers");
    const { registerWorkbenchUser } = await import(
      "../../../../lib/workbench/workbench-registration"
    );
    const cookieStore = {
      set: vi.fn(),
    };
    vi.mocked(cookies).mockResolvedValueOnce(
      cookieStore as unknown as Awaited<ReturnType<typeof cookies>>,
    );

    const response = await POST(
      new Request("http://localhost:3000/api/workbench/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Alice",
          email: "alice@example.com",
          password: "correct-password",
          verificationCode: "123456",
        }),
      }),
    );
    const body = (await response.json()) as {
      ok: boolean;
      email: string;
      personalProjectId: string;
    };

    expect(response.status).toBe(200);
    expect(registerWorkbenchUser).toHaveBeenCalledWith({
      name: "Alice",
      email: "alice@example.com",
      password: "correct-password",
      verificationCode: "123456",
      cookieStore,
      request: expect.any(Request),
    });
    expect(body).toEqual({
      ok: true,
      email: "alice@example.com",
      name: "Alice",
      userId: "user_1",
      personalProjectId: "project_user_1_personal",
    });
  });

  it("forwards company registration intent without changing the login identity", async () => {
    const { registerWorkbenchUser } = await import(
      "../../../../lib/workbench/workbench-registration"
    );

    await POST(
      new Request("http://localhost:3000/api/workbench/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountType: "company",
          companyName: "Acme",
          name: "Alice",
          email: "alice@example.com",
          password: "correct-password",
          verificationCode: "123456",
        }),
      }),
    );

    expect(registerWorkbenchUser).toHaveBeenLastCalledWith(
      expect.objectContaining({
        accountType: "company",
        companyName: "Acme",
        name: "Alice",
        email: "alice@example.com",
      }),
    );
  });

  it("returns 409 for duplicate account email", async () => {
    const { registerWorkbenchUser } = await import(
      "../../../../lib/workbench/workbench-registration"
    );
    vi.mocked(registerWorkbenchUser).mockRejectedValueOnce(
      new Error("Workbench account already exists"),
    );

    const response = await POST(
      new Request("http://localhost:3000/api/workbench/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Alice",
          email: "alice@example.com",
          password: "correct-password",
          verificationCode: "123456",
        }),
      }),
    );
    const body = (await response.json()) as {
      ok: boolean;
      error: string;
    };

    expect(response.status).toBe(409);
    expect(body).toEqual({
      ok: false,
      error: "Workbench account already exists",
    });
  });

  it("sends a registration verification code before account creation", async () => {
    const { createWorkbenchRegistrationVerification } = await import(
      "../../../../lib/workbench/workbench-registration"
    );

    const response = await POST(
      new Request("http://localhost:3000/api/workbench/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          intent: "send-verification",
          email: "alice@example.com",
        }),
      }),
    );
    const body = (await response.json()) as {
      ok: boolean;
      email: string;
    };

    expect(response.status).toBe(200);
    expect(createWorkbenchRegistrationVerification).toHaveBeenCalledWith({
      email: "alice@example.com",
    });
    expect(body).toMatchObject({
      ok: true,
      email: "alice@example.com",
    });
  });
});
