import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAutomationGrant,
  listProjectAutomationGrants,
  revokeAutomationGrant,
} from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { GET, POST } from "./route";
import { POST as REVOKE } from "./[grantId]/revoke/route";

vi.mock("@humanthread/db", () => ({
  createAutomationGrant: vi.fn(),
  listProjectAutomationGrants: vi.fn(),
  revokeAutomationGrant: vi.fn(),
}));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const grant = {
  id: "grant_1",
  spaceId: "space_1",
  projectId: "project_1",
  bindingIds: ["binding_1"],
  nodeKeys: [],
  executionPlanes: ["local"],
  deviceIds: [],
  workerIds: [],
  agentProfileIds: [],
  providers: ["codex"],
  permission: "workspace_full",
  workspaceBindingIds: ["workspace_1"],
  allowedRelativePathPrefixes: ["."],
  tools: ["filesystem", "shell"],
  commandCategories: ["build", "test"],
  operationTypes: ["workspace.write"],
  networkTargets: [],
  recipients: [],
  credentialRefs: [],
  allowProduction: false,
  limits: { maxConcurrency: 1, maxDurationMs: 3_600_000, maxTokens: 100_000, maxCostUsd: 10, maxToolCalls: 1_000 },
  policyVersion: "policy_v1",
  status: "active",
  confirmedAt: "2026-07-30T16:00:00.000Z",
  expiresAt: "2026-07-31T16:00:00.000Z",
  revokedAt: null,
};

function postRequest(value: unknown) {
  return new Request("http://localhost/api/automation-grants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

describe("/api/automation-grants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_session", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  });

  it("lists Project grants through the signed actor", async () => {
    vi.mocked(listProjectAutomationGrants).mockResolvedValue([grant] as never);

    const response = await GET(new Request("http://localhost/api/automation-grants?projectId=project_1"));

    expect(response.status).toBe(200);
    expect(listProjectAutomationGrants).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_session",
      projectId: "project_1",
    }));
    await expect(response.json()).resolves.toEqual({ ok: true, result: [grant] });
  });

  it("creates a confirmed grant without accepting a caller-controlled actor", async () => {
    vi.mocked(createAutomationGrant).mockResolvedValue({ id: "grant_1", status: "active", version: 1 } as never);

    const response = await POST(postRequest({
      commandId: "create_grant_1",
      projectId: "project_1",
      grant,
      confirmationFingerprint: "sha256:confirmed",
    }));

    expect(response.status).toBe(201);
    expect(createAutomationGrant).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_session",
      projectId: "project_1",
      commandId: "create_grant_1",
      grant,
      confirmationFingerprint: "sha256:confirmed",
    }));
  });

  it("rejects unknown fields before creating a grant", async () => {
    const response = await POST(postRequest({
      commandId: "create_grant_1",
      projectId: "project_1",
      grant,
      confirmationFingerprint: "sha256:confirmed",
      actorUserId: "forged_user",
    }));

    expect(response.status).toBe(400);
    expect(createAutomationGrant).not.toHaveBeenCalled();
  });

  it("revokes a grant through the signed actor", async () => {
    vi.mocked(revokeAutomationGrant).mockResolvedValue({ id: "grant_1", status: "revoked", version: 2 } as never);
    const request = new Request("http://localhost/api/automation-grants/grant_1/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "revoke_grant_1", projectId: "project_1" }),
    });

    const response = await REVOKE(request, { params: Promise.resolve({ grantId: "grant_1" }) });

    expect(response.status).toBe(200);
    expect(revokeAutomationGrant).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_session",
      projectId: "project_1",
      grantId: "grant_1",
      commandId: "revoke_grant_1",
    }));
  });

  it("maps a missing signed session to 401", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValue(new Error("Workbench API authentication required"));

    const response = await GET(new Request("http://localhost/api/automation-grants?projectId=project_1"));

    expect(response.status).toBe(401);
    expect(listProjectAutomationGrants).not.toHaveBeenCalled();
  });
});
