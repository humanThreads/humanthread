import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  revokeDesktopWorkspace,
  updateDesktopWorkspace,
} from "@/lib/desktop/desktop-execution-configuration";
import { DELETE, PUT } from "./route";

vi.mock("@/lib/desktop/desktop-execution-configuration", () => ({
  revokeDesktopWorkspace: vi.fn(),
  updateDesktopWorkspace: vi.fn(),
}));

const workspace = {
  id: "workspace_binding_1",
  projectId: "project_1",
  userId: "user_1",
  localDeviceId: "device_1",
  status: "ready",
  pathFingerprint: "hmac-sha256:abc123",
  configurationVersion: 2,
  lastValidatedAt: "2026-07-31T08:00:00.000Z",
};

describe("Desktop Project Workspace configuration route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates the current device binding with Desktop CORS", async () => {
    vi.mocked(updateDesktopWorkspace).mockResolvedValue(workspace as never);
    const response = await PUT(request("PUT", {
      commandId: "workspace:update:1",
      expectedVersion: 1,
      status: "ready",
      pathFingerprint: "hmac-sha256:abc123",
      validatedAt: "2026-07-31T08:00:00.000Z",
    }), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:1420");
    expect(await response.json()).toEqual({ ok: true, data: { workspace: {
      bindingId: "workspace_binding_1",
      status: "ready",
      pathFingerprint: "hmac-sha256:abc123",
      configurationVersion: 2,
      lastValidatedAt: "2026-07-31T08:00:00.000Z",
    } } });
  });

  it("rejects forged device identity and malformed fingerprints with 422", async () => {
    const response = await PUT(request("PUT", {
      commandId: "workspace:update:forged",
      status: "ready",
      pathFingerprint: "hmac-sha256:/Users/alice/Atlas",
      validatedAt: "2026-07-31T08:00:00.000Z",
      localDeviceId: "device_2",
    }), context());

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "validation_failed" });
    expect(updateDesktopWorkspace).not.toHaveBeenCalled();
  });

  it("revokes by optimistic version and maps a stale binding to 409", async () => {
    vi.mocked(revokeDesktopWorkspace).mockRejectedValue(Object.assign(
      new Error("Project Workspace version conflict"),
      { code: "version_conflict" },
    ));
    const response = await DELETE(request("DELETE", {
      commandId: "workspace:revoke:1",
      expectedVersion: 1,
    }), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "version_conflict" });
  });
});

function request(method: string, body: unknown) {
  return new Request("http://localhost:3000/api/desktop/projects/project_1/workspace?space=personal", {
    method,
    headers: {
      authorization: "Bearer v1.desktop",
      "content-type": "application/json",
      origin: "http://localhost:1420",
    },
    body: JSON.stringify(body),
  });
}

function context() {
  return { params: Promise.resolve({ projectId: "project_1" }) };
}
