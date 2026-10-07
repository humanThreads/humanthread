import { describe, expect, it, vi } from "vitest";

import { createConnectivityController } from "./connectivity";

describe("desktop connectivity gate", () => {
  it("keeps mutations disabled until every reconnect validation succeeds", async () => {
    const calls: string[] = [];
    const connectivity = createConnectivityController({
      now: () => new Date("2026-07-27T08:00:00.000Z"),
    });
    connectivity.markOffline();

    const reconnect = connectivity.reconnect({
      validateSession: async () => { calls.push("session"); },
      validateDevice: async () => { calls.push("device"); },
      validateSpace: async () => { calls.push("space"); },
      revalidateQueries: async () => { calls.push("queries"); },
    });

    expect(connectivity.getState()).toMatchObject({
      status: "reconnecting",
      mutationsEnabled: false,
    });
    await reconnect;
    expect(calls).toEqual(["session", "device", "space", "queries"]);
    expect(connectivity.getState()).toMatchObject({
      status: "online",
      mutationsEnabled: true,
      lastOnlineAt: "2026-07-27T08:00:00.000Z",
    });
  });

  it("returns to offline read-only state when reconnect validation fails", async () => {
    const connectivity = createConnectivityController();
    connectivity.markOffline();

    await expect(connectivity.reconnect({
      validateSession: vi.fn().mockResolvedValue(undefined),
      validateDevice: vi.fn().mockRejectedValue(new Error("device revoked")),
      validateSpace: vi.fn().mockResolvedValue(undefined),
      revalidateQueries: vi.fn().mockResolvedValue(undefined),
    })).rejects.toThrow("device revoked");
    expect(connectivity.getState()).toMatchObject({
      status: "offline",
      mutationsEnabled: false,
      error: "device revoked",
    });
  });

  it("coalesces concurrent reconnect requests into one validation pass", async () => {
    const validateSession = vi.fn().mockResolvedValue(undefined);
    const dependencies = {
      validateSession,
      validateDevice: vi.fn().mockResolvedValue(undefined),
      validateSpace: vi.fn().mockResolvedValue(undefined),
      revalidateQueries: vi.fn().mockResolvedValue(undefined),
    };
    const connectivity = createConnectivityController();
    connectivity.markOffline();

    await Promise.all([
      connectivity.reconnect(dependencies),
      connectivity.reconnect(dependencies),
    ]);

    expect(validateSession).toHaveBeenCalledTimes(1);
  });
});
