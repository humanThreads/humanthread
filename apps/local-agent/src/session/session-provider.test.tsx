import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { loadAgentState, type LocalAgentState, type StorageLike } from "../lib/binding";
import { createDesktopQueryClient } from "../lib/query-client";
import { DesktopSessionProvider, useDesktopSession } from "./session-provider";

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function createState(storage: StorageLike): LocalAgentState {
  return loadAgentState({
    storage,
    fallbackDeviceName: "agent-macbook",
    createId: () => "install_1",
    now: () => "2026-07-27T08:00:00.000Z",
  });
}

function legacyAuthenticatedState(storage: StorageLike): LocalAgentState {
  const state = createState(storage);
  const sessionKey = "https://humanthread.example::owner@example.com";
  return {
    ...state,
    activeSessionKey: sessionKey,
    accountSessions: {
      [sessionKey]: {
        sessionKey,
        apiBaseUrl: "https://humanthread.example",
        email: "owner@example.com",
        desktopSessionId: "desktop_session_old",
        activeSpaceKey: "company:company_1",
        teamId: "team_1",
        userId: "user_1",
        deviceId: "device-agent-macbook",
        deviceName: "agent-macbook",
        deviceToken: "legacy_device_token",
        apiToken: "legacy_api_token",
        lastLoginAt: "2026-07-27T08:00:00.000Z",
        lastUsedAt: "2026-07-27T08:00:00.000Z",
      },
    },
  };
}

function SessionProbe() {
  const session = useDesktopSession();
  const capturedGeneration = useRef(0);
  return (
    <div>
      <output aria-label="会话状态">{session.status}</output>
      <output aria-label="活动空间">{session.context?.spaceKey ?? "none"}</output>
      <output aria-label="设备凭据">{session.runtimeCredentials?.deviceToken ?? "none"}</output>
      <output aria-label="本地设备">{session.localDeviceId ?? "none"}</output>
      <output aria-label="会话代次">{session.generation}</output>
      <output aria-label="操作可用">{session.actionsEnabled ? "yes" : "no"}</output>
      <output aria-label="会话错误">{session.error ?? "none"}</output>
      <button onClick={() => void session.login({
        apiBaseUrl: "https://humanthread.example",
        email: "owner@example.com",
        password: "correct-password",
      })} type="button">开始登录</button>
      <button onClick={() => void session.logout()} type="button">退出登录</button>
      <button onClick={() => void session.switchSpace("company:company_1")} type="button">
        切换空间
      </button>
      <button onClick={() => {
        capturedGeneration.current = session.generation;
      }} type="button">捕获会话代次</button>
      <button onClick={() => {
        session.updateRuntimeCredentials({
          deviceToken: "stale_device_token",
          apiToken: "",
        }, capturedGeneration.current);
      }} type="button">提交旧凭据</button>
    </div>
  );
}

function renderProvider(input: {
  fetch: typeof fetch;
  state?: LocalAgentState;
  onStateChange?: (state: LocalAgentState) => void;
}) {
  const storage = createMemoryStorage();
  const initialState = input.state ?? createState(storage);
  function Harness() {
    const [state, setState] = useState(initialState);
    return (
      <DesktopSessionProvider
        environment={{ storage, fallbackDeviceName: "agent-macbook" }}
        fetch={input.fetch}
        platform="macos"
        state={state}
        onStateChange={(nextState) => {
          setState(nextState);
          input.onStateChange?.(nextState);
        }}
      >
        <SessionProbe />
      </DesktopSessionProvider>
    );
  }
  return render(
    <QueryClientProvider client={createDesktopQueryClient()}>
      <Harness />
    </QueryClientProvider>,
  );
}

function successfulFetch(input: RequestInfo | URL): Promise<Response> {
  const pathname = new URL(String(input)).pathname;
  if (pathname === "/api/desktop/session") {
    return Promise.resolve(Response.json({
      ok: true,
      data: {
        accessToken: "access_1",
        accessExpiresAt: "2026-07-27T08:15:00.000Z",
        refreshToken: "refresh_1",
        sessionId: "desktop_session_1",
        user: { id: "user_1", email: "owner@example.com", name: "Owner", avatarUrl: null },
        device: { id: "device_1", status: "authorized", deviceToken: "device_1_token" },
      },
    }));
  }
  return Promise.resolve(Response.json({
    ok: true,
    data: {
      spaces: [{ key: "personal", kind: "personal", name: "个人空间" }],
      activeSpaceKey: "personal",
      currentTask: null,
      capabilities: { nativeExecution: true },
    },
  }));
}

describe("desktop session provider", () => {
  it("starts signed out without requesting session recovery from legacy metadata", () => {
    const fetchImplementation = vi.fn(successfulFetch);
    const storage = createMemoryStorage();

    renderProvider({
      fetch: fetchImplementation,
      state: legacyAuthenticatedState(storage),
    });

    expect(screen.getByLabelText("会话状态")).toHaveTextContent("signed_out");
    expect(screen.getByLabelText("设备凭据")).toHaveTextContent("none");
    expect(screen.getByLabelText("本地设备")).toHaveTextContent("none");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("keeps login credentials in the current provider process", async () => {
    const user = userEvent.setup();
    const persistedStates: LocalAgentState[] = [];
    renderProvider({
      fetch: successfulFetch,
      onStateChange: (state) => persistedStates.push(state),
    });

    await user.click(screen.getByRole("button", { name: "开始登录" }));

    expect(await screen.findByText("ready")).toBeInTheDocument();
    expect(screen.getByLabelText("活动空间")).toHaveTextContent("personal");
    expect(screen.getByLabelText("设备凭据")).toHaveTextContent("device_1_token");
    expect(screen.getByLabelText("本地设备")).toHaveTextContent("device_1");
    expect(persistedStates.at(-1)?.activeSessionKey)
      .toBe("https://humanthread.example::owner@example.com");
  });

  it("migrates the historical default device ID before Desktop login", async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const persistedStates: LocalAgentState[] = [];
    const loginBodies: unknown[] = [];
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/api/desktop/session") {
        loginBodies.push(JSON.parse(String(init?.body)));
        return Response.json({
          ok: true,
          data: {
            accessToken: "access_1",
            accessExpiresAt: "2026-07-27T08:15:00.000Z",
            refreshToken: "refresh_1",
            sessionId: "desktop_session_1",
            user: { id: "user_1", email: "owner@example.com", name: "Owner", avatarUrl: null },
            device: {
              id: "device-agent-macbook-install_1",
              status: "authorized",
              deviceToken: "device_scoped_token",
            },
          },
        });
      }
      return successfulFetch(input);
    });

    renderProvider({
      fetch: fetchImplementation,
      state: legacyAuthenticatedState(storage),
      onStateChange: (state) => persistedStates.push(state),
    });

    await user.click(screen.getByRole("button", { name: "开始登录" }));

    expect(await screen.findByText("ready")).toBeInTheDocument();
    expect(loginBodies).toContainEqual(expect.objectContaining({
      installationId: "install_1",
      deviceId: "device-agent-macbook-install_1",
      deviceName: "agent-macbook",
    }));
    expect(persistedStates.at(-1)?.accountSessions[
      "https://humanthread.example::owner@example.com"
    ]?.deviceId).toBe("device-agent-macbook-install_1");
  });

  it("sends an installation-scoped display name for MacIntel", async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const state = createState(storage);
    const loginBodies: unknown[] = [];
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname === "/api/desktop/session") {
        loginBodies.push(JSON.parse(String(init?.body)));
        return Response.json({
          ok: true,
          data: {
            accessToken: "access_1",
            accessExpiresAt: "2026-07-27T08:15:00.000Z",
            refreshToken: "refresh_1",
            sessionId: "desktop_session_1",
            user: { id: "user_1", email: "owner@example.com", name: "Owner", avatarUrl: null },
            device: { id: "device-macintel-install_1", status: "authorized", deviceToken: "device_1_token" },
          },
        });
      }
      return successfulFetch(input);
    });

    renderProvider({
      fetch: fetchImplementation,
      state: {
        ...state,
        installProfile: { ...state.installProfile, defaultDeviceName: "MacIntel" },
      },
    });
    await user.click(screen.getByRole("button", { name: "开始登录" }));

    expect(await screen.findByText("ready")).toBeInTheDocument();
    expect(loginBodies).toContainEqual(expect.objectContaining({
      deviceId: "device-macintel-install_1",
      deviceName: "MacIntel - 1",
    }));
  });

  it("clears runtime credentials when remote logout fails", async () => {
    const user = userEvent.setup();
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname === "/api/desktop/session/logout") {
        return Response.json({ ok: false, code: "internal_error", error: "failed" }, { status: 500 });
      }
      return successfulFetch(input);
    });
    renderProvider({ fetch: fetchImplementation });
    await user.click(screen.getByRole("button", { name: "开始登录" }));
    expect(await screen.findByText("ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "退出登录" }));

    expect(await screen.findByText("signed_out")).toBeInTheDocument();
    expect(screen.getByLabelText("设备凭据")).toHaveTextContent("none");
    expect(screen.getByLabelText("本地设备")).toHaveTextContent("none");
    expect(screen.getByLabelText("会话错误")).toHaveTextContent("none");
  });

  it("signs out immediately while remote logout is still pending", async () => {
    const user = userEvent.setup();
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname === "/api/desktop/session/logout") {
        return new Promise<Response>(() => {});
      }
      return successfulFetch(input);
    });
    renderProvider({ fetch: fetchImplementation });
    await user.click(screen.getByRole("button", { name: "开始登录" }));
    expect(await screen.findByText("ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "退出登录" }));

    expect(screen.getByLabelText("会话状态")).toHaveTextContent("signed_out");
    expect(screen.getByLabelText("设备凭据")).toHaveTextContent("none");
  });

  it("rejects a runtime credential update captured before logout", async () => {
    const user = userEvent.setup();
    renderProvider({ fetch: successfulFetch });
    await user.click(screen.getByRole("button", { name: "开始登录" }));
    expect(await screen.findByText("ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "捕获会话代次" }));
    await user.click(screen.getByRole("button", { name: "退出登录" }));
    expect(await screen.findByText("signed_out")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "提交旧凭据" }));

    expect(screen.getByLabelText("设备凭据")).toHaveTextContent("none");
  });

  it("discards a space switch response that completes after logout", async () => {
    const user = userEvent.setup();
    let bootstrapCalls = 0;
    let resolveSwitch!: (response: Response) => void;
    const switchResponse = new Promise<Response>((resolve) => {
      resolveSwitch = resolve;
    });
    const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/api/desktop/session/bootstrap") {
        bootstrapCalls += 1;
        if (bootstrapCalls === 2) return switchResponse;
      }
      return successfulFetch(input);
    });
    renderProvider({ fetch: fetchImplementation });
    await user.click(screen.getByRole("button", { name: "开始登录" }));
    expect(await screen.findByText("ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "切换空间" }));
    expect(screen.getByLabelText("会话状态")).toHaveTextContent("switching");
    await user.click(screen.getByRole("button", { name: "退出登录" }));
    resolveSwitch(Response.json({
      ok: true,
      data: {
        spaces: [{ key: "company:company_1", kind: "company", name: "Acme" }],
        activeSpaceKey: "company:company_1",
        currentTask: null,
        capabilities: { nativeExecution: true },
      },
    }));

    expect(await screen.findByText("signed_out")).toBeInTheDocument();
    expect(screen.getByLabelText("活动空间")).toHaveTextContent("none");
    expect(screen.getByLabelText("操作可用")).toHaveTextContent("no");
  });
});
