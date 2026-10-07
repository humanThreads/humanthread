import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { desktopNotificationsResponseSchema } from "@humanthread/workbench-client";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useOptionalDesktopSession } from "../../session/session-provider";
import { useDesktopNotifications } from "./use-desktop-notifications";

vi.mock("../../session/session-provider", () => ({
  useOptionalDesktopSession: vi.fn(),
}));

function wrapper(props: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>;
}

describe("useDesktopNotifications", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the selected Space through the strict notification contract", async () => {
    const response = {
      ok: true as const,
      data: { summary: { unreadCount: 0, todayCount: 0 }, items: [] },
    };
    const request = vi.fn().mockResolvedValue(response);
    vi.mocked(useOptionalDesktopSession).mockReturnValue({
      client: { request },
      context: {
        deploymentKey: "https://ht.example.com",
        sessionId: "session_1",
        spaceKey: "company:company_1",
      },
    } as never);

    const { result } = renderHook(() => useDesktopNotifications(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(response);
    expect(request).toHaveBeenCalledWith(
      "/api/desktop/notifications?space=company%3Acompany_1",
      desktopNotificationsResponseSchema,
    );
  });

  it("does not fetch before a desktop session context is available", () => {
    vi.mocked(useOptionalDesktopSession).mockReturnValue(null);

    const { result } = renderHook(() => useDesktopNotifications(), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });
});
