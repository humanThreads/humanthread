import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  readDesktopAgentRuntimes,
  updateDesktopAgentRuntime,
} from "@/lib/desktop/desktop-execution-configuration";
import { GET, PUT } from "./route";

vi.mock("@/lib/desktop/desktop-execution-configuration", () => ({
  readDesktopAgentRuntimes: vi.fn(),
  updateDesktopAgentRuntime: vi.fn(),
}));

const runtimeProfile = {
  id: "runtime_profile_1",
  userId: "user_1",
  localDeviceId: "device_1",
  provider: "codex",
  label: "Codex CLI",
  status: "ready",
  version: 2,
  capabilities: ["commands", "workspace"],
  modelSites: [],
  lastValidatedAt: "2026-07-31T08:00:00.000Z",
};

describe("Desktop Agent runtime configuration route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists current-device runtime readiness", async () => {
    vi.mocked(readDesktopAgentRuntimes).mockResolvedValue([runtimeProfile] as never);
    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { runtimeProfiles: [runtimeProfile] },
    });
  });

  it("updates runtime readiness without accepting secrets or executable paths", async () => {
    vi.mocked(updateDesktopAgentRuntime).mockResolvedValue(runtimeProfile as never);
    const response = await PUT(request("PUT", {
      commandId: "runtime:update:1",
      expectedVersion: 1,
      provider: "codex",
      label: "Codex CLI",
      status: "ready",
      capabilities: ["workspace", "commands"],
      validatedAt: "2026-07-31T08:00:00.000Z",
    }));

    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toMatch(/credential|executablePath|\/opt\/homebrew/u);
  });

  it("returns 422 for malformed capabilities before invoking the command", async () => {
    const response = await PUT(request("PUT", {
      commandId: "runtime:update:invalid",
      provider: "codex",
      label: "Codex CLI",
      status: "ready",
      capabilities: ["x".repeat(65)],
      validatedAt: "2026-07-31T08:00:00.000Z",
    }));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "validation_failed" });
    expect(updateDesktopAgentRuntime).not.toHaveBeenCalled();
  });

  it("maps a stale runtime version to 409", async () => {
    vi.mocked(updateDesktopAgentRuntime).mockRejectedValue(Object.assign(
      new Error("Device Agent runtime version conflict"),
      { code: "version_conflict" },
    ));
    const response = await PUT(request("PUT", {
      commandId: "runtime:update:stale",
      expectedVersion: 1,
      provider: "codex",
      label: "Codex CLI",
      status: "ready",
      capabilities: ["workspace"],
      validatedAt: "2026-07-31T08:00:00.000Z",
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "version_conflict" });
  });
});

function request(method: string, body?: unknown) {
  return new Request("http://localhost:3000/api/desktop/agent-runtimes?space=personal", {
    method,
    headers: {
      authorization: "Bearer v1.desktop",
      "content-type": "application/json",
      origin: "http://localhost:1420",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
