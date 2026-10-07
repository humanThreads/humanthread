import { describe, expect, it, vi } from "vitest";

import {
  buildDesktopConfigurationAggregateId,
  readDesktopAgentRuntimes,
  revokeDesktopWorkspace,
  updateDesktopAgentRuntime,
  updateDesktopWorkspace,
} from "./desktop-execution-configuration";

const desktopContext = {
  actor: { userId: "user_1", authKind: "desktop_token", sessionId: "session_1" },
  space: {
    id: "space_1",
    key: "personal",
    kind: "personal",
    name: "Personal",
    role: "owner",
    companyId: null,
  },
  spaces: [],
  workbench: {
    userId: "user_1",
    teamId: "team_1",
    projectId: "project_1",
    matterTypeId: "matter_1",
  },
  nativeExecutionAuthorized: true,
  localDeviceId: "device_1",
} as const;

const workspace = {
  id: "workspace_binding_1",
  projectId: "project_1",
  userId: "user_1",
  localDeviceId: "device_1",
  status: "ready",
  pathFingerprint: "hmac-sha256:abc123",
  configurationVersion: 2,
  lastValidatedAt: "2026-07-31T08:00:00.000Z",
} as const;

const runtime = {
  id: "runtime_profile_1",
  userId: "user_1",
  localDeviceId: "device_1",
  provider: "codex",
  label: "Codex CLI",
  status: "ready",
  version: 2,
  capabilities: ["commands", "workspace"],
  lastValidatedAt: "2026-07-31T08:00:00.000Z",
} as const;

function dependencies() {
  return {
    resolveDesktopReadContext: vi.fn().mockResolvedValue(desktopContext),
    listDeviceExecutionConfiguration: vi.fn().mockResolvedValue({
      workspaces: [workspace],
      runtimeProfiles: [runtime],
    }),
    executeWorkspaceUpsert: vi.fn().mockResolvedValue(workspace),
    executeWorkspaceRevoke: vi.fn().mockResolvedValue({
      ...workspace,
      status: "revoked",
      configurationVersion: 3,
    }),
    executeRuntimeUpsert: vi.fn().mockResolvedValue(runtime),
  };
}

describe("Desktop execution configuration", () => {
  it("bounds long project and device aggregate IDs for command receipts", () => {
    const projectId = "p".repeat(64);
    const localDeviceId = "d".repeat(64);

    const aggregateId = buildDesktopConfigurationAggregateId([projectId, localDeviceId]);

    expect(aggregateId).toMatch(/^desktop-config:[a-f0-9]{64}$/u);
    expect(aggregateId.length).toBeLessThanOrEqual(96);
    expect(buildDesktopConfigurationAggregateId(["project_1", "device_1"]))
      .toBe("project_1:device_1");
  });

  it("derives the Workspace owner and device from the Desktop session", async () => {
    const deps = dependencies();

    await expect(updateDesktopWorkspace(
      request(),
      "project_1",
      {
        commandId: "workspace:update:1",
        expectedVersion: 1,
        status: "ready",
        pathFingerprint: "hmac-sha256:abc123",
        validatedAt: "2026-07-31T08:00:00.000Z",
      },
      deps,
    )).resolves.toEqual(workspace);

    expect(deps.executeWorkspaceUpsert).toHaveBeenCalledWith({
      actorUserId: "user_1",
      localDeviceId: "device_1",
      projectId: "project_1",
      commandId: "workspace:update:1",
      expectedVersion: 1,
      status: "ready",
      pathFingerprint: "hmac-sha256:abc123",
      validatedAt: new Date("2026-07-31T08:00:00.000Z"),
    });
  });

  it("rejects a caller-supplied device before executing a Workspace command", async () => {
    const deps = dependencies();

    await expect(updateDesktopWorkspace(
      request(),
      "project_1",
      {
        commandId: "workspace:update:forged",
        status: "ready",
        pathFingerprint: "hmac-sha256:abc123",
        validatedAt: "2026-07-31T08:00:00.000Z",
        localDeviceId: "device_2",
      } as never,
      deps,
    )).rejects.toMatchObject({ code: "validation_failed" });

    expect(deps.executeWorkspaceUpsert).not.toHaveBeenCalled();
  });

  it("requires a native authorized Desktop session for device configuration", async () => {
    const deps = dependencies();
    deps.resolveDesktopReadContext.mockResolvedValue({
      ...desktopContext,
      actor: { userId: "user_1", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      nativeExecutionAuthorized: false,
      localDeviceId: null,
    } as never);

    await expect(readDesktopAgentRuntimes(request(), deps)).rejects.toMatchObject({
      code: "authorization_denied",
    });
    expect(deps.listDeviceExecutionConfiguration).not.toHaveBeenCalled();
  });

  it("lists and updates only the current device runtime", async () => {
    const deps = dependencies();

    await expect(readDesktopAgentRuntimes(request(), deps)).resolves.toEqual([runtime]);
    await expect(updateDesktopAgentRuntime(request(), {
      commandId: "runtime:update:1",
      expectedVersion: 1,
      provider: "codex",
      label: "Codex CLI",
      status: "ready",
      capabilities: ["workspace", "commands"],
      validatedAt: "2026-07-31T08:00:00.000Z",
    }, deps)).resolves.toEqual(runtime);
    await expect(revokeDesktopWorkspace(request(), "project_1", {
      commandId: "workspace:revoke:1",
      expectedVersion: 2,
    }, deps)).resolves.toMatchObject({ status: "revoked", configurationVersion: 3 });

    expect(deps.listDeviceExecutionConfiguration).toHaveBeenCalledWith({
      actorUserId: "user_1",
      localDeviceId: "device_1",
    });
    expect(deps.executeRuntimeUpsert).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_1",
      localDeviceId: "device_1",
      provider: "codex",
    }));
    expect(deps.executeWorkspaceRevoke).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_1",
      localDeviceId: "device_1",
      projectId: "project_1",
    }));
  });
});

function request() {
  return new Request("http://localhost/api/desktop/agent-runtimes", {
    headers: { authorization: "Bearer v1.desktop" },
  });
}
