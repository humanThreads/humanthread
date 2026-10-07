import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDesktopAuthClient, loginDesktopSession } from "./desktop-auth";

const responseSchema = z.object({
  ok: z.literal(true),
  data: z.object({ path: z.string() }),
});

const strictNestedResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    project: z.object({
      id: z.string().min(1),
    }).strict(),
  }).strict(),
}).strict();

describe("desktop auth client", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fails a stalled desktop login request with a retryable timeout error", async () => {
    vi.useFakeTimers();
    let failure: unknown;
    let requestSignal: AbortSignal | null = null;
    void loginDesktopSession({
      apiBaseUrl: "https://humanthread.example",
      email: "owner@example.com",
      password: "correct-password",
      installationId: "install_1",
      deviceId: "device_1",
      deviceName: "MacBook",
      platform: "macos",
    }, {
      fetch: (_input, init) => {
        requestSignal = init?.signal ?? null;
        return new Promise<Response>(() => {});
      },
    }).catch((error: unknown) => {
      failure = error;
    });

    await vi.advanceTimersByTimeAsync(15_000);

    expect(failure).toEqual(
      new Error("登录服务器响应超时，请检查网络后重试。"),
    );
    expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("times out when the desktop login response body never finishes", async () => {
    vi.useFakeTimers();
    let failure: unknown;
    let requestSignal: AbortSignal | null = null;
    const response = Response.json({ ok: true, data: {} });
    vi.spyOn(response, "json").mockImplementation(
      () => new Promise<unknown>(() => {}),
    );

    void loginDesktopSession({
      apiBaseUrl: "https://humanthread.example",
      email: "owner@example.com",
      password: "correct-password",
      installationId: "install_1",
      deviceId: "device_1",
      deviceName: "MacBook",
      platform: "macos",
    }, {
      fetch: (_input, init) => {
        requestSignal = init?.signal ?? null;
        return Promise.resolve(response);
      },
    }).catch((error: unknown) => {
      failure = error;
    });

    await vi.advanceTimersByTimeAsync(15_000);

    expect(failure).toEqual(
      new Error("登录服务器响应超时，请检查网络后重试。"),
    );
    expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("shares one refresh across concurrent unauthorized workbench requests", async () => {
    let refreshCalls = 0;
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get("authorization");

      if (url.endsWith("/api/desktop/session/refresh")) {
        refreshCalls += 1;
        return Response.json({
          ok: true,
          data: {
            accessToken: "access_2",
            accessExpiresAt: "2026-07-27T09:00:00.000Z",
            refreshToken: "refresh_2",
            sessionId: "desktop_session_1",
          },
        });
      }

      if (authorization === "Bearer access_1") {
        return Response.json(
          { ok: false, code: "authentication_required", error: "expired" },
          { status: 401 },
        );
      }

      return Response.json({
        ok: true,
        data: { path: new URL(url).pathname },
      });
    });
    const client = createDesktopAuthClient({
      apiBaseUrl: "https://humanthread.example",
      sessionId: "desktop_session_1",
      accessToken: "access_1",
      accessExpiresAt: "2026-07-27T08:00:00.000Z",
      refreshToken: "refresh_1",
      fetch: fetchImplementation,
    });

    const [dashboard, tasks] = await Promise.all([
      client.request("/api/desktop/dashboard", responseSchema),
      client.request("/api/tasks", responseSchema),
    ]);

    expect(dashboard.data.path).toBe("/api/desktop/dashboard");
    expect(tasks.data.path).toBe("/api/tasks");
    expect(refreshCalls).toBe(1);
    expect(client.getSession()).toEqual({
      accessToken: "access_2",
      accessExpiresAt: "2026-07-27T09:00:00.000Z",
      sessionId: "desktop_session_1",
    });
    expect(client.getRuntimeCredentials()).toEqual({
      accessToken: "access_2",
      accessExpiresAt: "2026-07-27T09:00:00.000Z",
      refreshToken: "refresh_2",
      sessionId: "desktop_session_1",
    });
  });

  it("supports device-token-only agent requests without sending the desktop bearer token", async () => {
    const fetchImplementation = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get("x-agent-device-token")).toBe("device_token_123");
      return Response.json({
        ok: true,
        data: { path: "/api/agent/projects/project_1/loop-catalog" },
      });
    });
    const client = createDesktopAuthClient({
      apiBaseUrl: "https://humanthread.example",
      sessionId: "desktop_session_1",
      accessToken: "desktop_access_token",
      accessExpiresAt: "2026-07-27T09:00:00.000Z",
      refreshToken: "refresh_1",
      fetch: fetchImplementation,
    });

    await expect(client.requestDeviceAuthorized(
      "/api/agent/projects/project_1/loop-catalog",
      responseSchema,
      { headers: { "x-agent-device-token": "device_token_123" } },
    )).resolves.toEqual({
      ok: true,
      data: { path: "/api/agent/projects/project_1/loop-catalog" },
    });
  });

  it("ignores future fields in strict nested Desktop responses", async () => {
    const client = createDesktopAuthClient({
      apiBaseUrl: "https://humanthread.example",
      sessionId: "desktop_session_1",
      accessToken: "access_1",
      accessExpiresAt: "2026-07-27T09:00:00.000Z",
      refreshToken: "refresh_1",
      fetch: async () => Response.json({
        ok: true,
        futureEnvelopeField: "ignored",
        data: {
          futureDataField: "ignored",
          project: {
            id: "project_1",
            futureProjectField: "ignored",
          },
        },
      }),
    });

    await expect(client.request("/api/desktop/projects/project_1", strictNestedResponseSchema))
      .resolves.toEqual({
        ok: true,
        data: { project: { id: "project_1" } },
      });
  });

  it("refreshes from the in-memory login credential and rotates it in memory", async () => {
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/desktop/session/refresh")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          sessionId: "desktop_session_1",
          refreshToken: "refresh_from_login",
        });
        return Response.json({
          ok: true,
          data: {
            accessToken: "access_2",
            accessExpiresAt: "2026-07-27T09:00:00.000Z",
            refreshToken: "refresh_2",
            sessionId: "desktop_session_1",
          },
        });
      }
      return Response.json({ ok: true, data: { path: new URL(url).pathname } });
    });
    const client = createDesktopAuthClient({
      apiBaseUrl: "https://humanthread.example",
      sessionId: "desktop_session_1",
      refreshToken: "refresh_from_login",
      fetch: fetchImplementation,
    });

    await client.request("/api/desktop/dashboard", responseSchema);

    expect(client.getRuntimeCredentials().refreshToken).toBe("refresh_2");
  });

  it("rejects refresh when the current process has no refresh credential", async () => {
    const client = createDesktopAuthClient({
      apiBaseUrl: "https://humanthread.example",
      sessionId: "desktop_session_1",
      fetch: vi.fn(),
    });

    await expect(client.request("/api/desktop/dashboard", responseSchema))
      .rejects.toMatchObject({ kind: "unauthenticated" });
  });

  it("does not restore credentials when an in-flight refresh finishes after logout", async () => {
    let resolveRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/api/desktop/session/refresh") return refreshResponse;
      if (pathname === "/api/desktop/session/logout") {
        return Response.json({ ok: true });
      }
      return Response.json(
        { ok: false, code: "authentication_required", error: "expired" },
        { status: 401 },
      );
    });
    const client = createDesktopAuthClient({
      apiBaseUrl: "https://humanthread.example",
      sessionId: "desktop_session_1",
      accessToken: "access_1",
      accessExpiresAt: "2026-07-27T08:15:00.000Z",
      refreshToken: "refresh_1",
      fetch: fetchImplementation,
    });

    const request = client.request("/api/desktop/dashboard", responseSchema);
    await vi.waitFor(() => {
      expect(fetchImplementation).toHaveBeenCalledTimes(2);
    });
    await client.logout();
    resolveRefresh(Response.json({
      ok: true,
      data: {
        accessToken: "access_after_logout",
        accessExpiresAt: "2026-07-27T09:00:00.000Z",
        refreshToken: "refresh_after_logout",
        sessionId: "desktop_session_1",
      },
    }));

    await expect(request).rejects.toBeDefined();
    expect(client.getRuntimeCredentials()).toEqual({
      accessToken: "",
      accessExpiresAt: "",
      refreshToken: "",
      sessionId: "",
    });
  });

  it("aborts a stalled refresh transport after fifteen seconds", async () => {
    vi.useFakeTimers();
    let failure: unknown;
    let requestSignal: AbortSignal | null = null;
    const client = createDesktopAuthClient({
      apiBaseUrl: "https://humanthread.example",
      sessionId: "desktop_session_1",
      refreshToken: "refresh_1",
      fetch: (_input, init) => {
        requestSignal = init?.signal ?? null;
        return new Promise<Response>(() => {});
      },
    });

    void client.request("/api/desktop/dashboard", responseSchema)
      .catch((error: unknown) => {
        failure = error;
      });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(failure).toEqual(new Error("会话刷新响应超时，请重新登录。"));
    expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("aborts a refresh whose response body never finishes", async () => {
    vi.useFakeTimers();
    let failure: unknown;
    let requestSignal: AbortSignal | null = null;
    const response = Response.json({ ok: true, data: {} });
    vi.spyOn(response, "json").mockImplementation(
      () => new Promise<unknown>(() => {}),
    );
    const client = createDesktopAuthClient({
      apiBaseUrl: "https://humanthread.example",
      sessionId: "desktop_session_1",
      refreshToken: "refresh_1",
      fetch: (_input, init) => {
        requestSignal = init?.signal ?? null;
        return Promise.resolve(response);
      },
    });

    void client.request("/api/desktop/dashboard", responseSchema)
      .catch((error: unknown) => {
        failure = error;
      });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(failure).toEqual(new Error("会话刷新响应超时，请重新登录。"));
    expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("clears in-memory credentials when remote logout fails", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const client = createDesktopAuthClient({
      apiBaseUrl: "https://humanthread.example",
      sessionId: "desktop_session_1",
      accessToken: "access_1",
      accessExpiresAt: "2026-07-27T08:15:00.000Z",
      refreshToken: "refresh_1",
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body)),
        });
        return Response.json(
          { ok: false, code: "internal_error", error: "logout failed" },
          { status: 500 },
        );
      },
    });

    await expect(client.logout()).rejects.toBeDefined();

    expect(requests).toEqual([{
      url: "https://humanthread.example/api/desktop/session/logout",
      body: {
        sessionId: "desktop_session_1",
        refreshToken: "refresh_1",
      },
    }]);
    expect(client.getRuntimeCredentials()).toEqual({
      accessToken: "",
      accessExpiresAt: "",
      refreshToken: "",
      sessionId: "",
    });
  });

  it("aborts a stalled remote logout and clears in-memory credentials", async () => {
    vi.useFakeTimers();
    let failure: unknown;
    let requestSignal: AbortSignal | null = null;
    const client = createDesktopAuthClient({
      apiBaseUrl: "https://humanthread.example",
      sessionId: "desktop_session_1",
      accessToken: "access_1",
      accessExpiresAt: "2026-07-27T08:15:00.000Z",
      refreshToken: "refresh_1",
      fetch: (_input, init) => {
        requestSignal = init?.signal ?? null;
        return new Promise<Response>(() => {});
      },
    });

    void client.logout().catch((error: unknown) => {
      failure = error;
    });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(failure).toEqual(new Error("退出登录响应超时，本机会话已清除。"));
    expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(client.getRuntimeCredentials()).toEqual({
      accessToken: "",
      accessExpiresAt: "",
      refreshToken: "",
      sessionId: "",
    });
  });

  it("times out a stalled logout error body and clears credentials", async () => {
    vi.useFakeTimers();
    let failure: unknown;
    let requestSignal: AbortSignal | null = null;
    const response = Response.json(
      { ok: false, code: "internal_error", error: "failed" },
      { status: 500 },
    );
    vi.spyOn(response, "json").mockImplementation(
      () => new Promise<unknown>(() => {}),
    );
    const client = createDesktopAuthClient({
      apiBaseUrl: "https://humanthread.example",
      sessionId: "desktop_session_1",
      accessToken: "access_1",
      accessExpiresAt: "2026-07-27T08:15:00.000Z",
      refreshToken: "refresh_1",
      fetch: (_input, init) => {
        requestSignal = init?.signal ?? null;
        return Promise.resolve(response);
      },
    });

    void client.logout().catch((error: unknown) => {
      failure = error;
    });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(failure).toEqual(new Error("退出登录响应超时，本机会话已清除。"));
    expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(client.getRuntimeCredentials()).toEqual({
      accessToken: "",
      accessExpiresAt: "",
      refreshToken: "",
      sessionId: "",
    });
  });
});
