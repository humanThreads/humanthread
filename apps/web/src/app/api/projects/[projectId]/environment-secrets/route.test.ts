import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkbenchApiActor } from "../../../../../lib/workbench/workbench-api-session";
import { createProjectEnvironmentSecret, getProjectRepository, listProjectEnvironmentSecrets, rotateProjectEnvironmentSecret } from "@humanthread/db";
import { GET, POST, PUT } from "./route";

vi.mock("../../../../../lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));
vi.mock("@humanthread/db", () => ({ createProjectEnvironmentSecret: vi.fn(), getProjectRepository: vi.fn(), listProjectEnvironmentSecrets: vi.fn(), rotateProjectEnvironmentSecret: vi.fn() }));

describe("project environment secret API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "session_1" });
    vi.mocked(getProjectRepository).mockResolvedValue({ configuration: null } as never);
  });

  it("lists redacted metadata only", async () => {
    vi.mocked(listProjectEnvironmentSecrets).mockResolvedValue([{ id: "a".repeat(32), projectId: "project_1", name: "HT_GIT_TOKEN", fingerprint: "b".repeat(64), status: "configured", version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]);
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: [{ name: "HT_GIT_TOKEN", status: "configured" }] });
    expect(listProjectEnvironmentSecrets).toHaveBeenCalledWith({ projectId: "project_1", actorUserId: "user_1" });
  });

  it("creates a managed secret without returning its value", async () => {
    vi.mocked(createProjectEnvironmentSecret).mockResolvedValue({ id: "a".repeat(32), projectId: "project_1", name: "HT_GIT_TOKEN", fingerprint: "b".repeat(64), status: "configured", version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ name: "HT_GIT_TOKEN", value: "secret" }), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(201);
    expect(createProjectEnvironmentSecret).toHaveBeenCalledWith({ projectId: "project_1", name: "HT_GIT_TOKEN", value: "secret", actorUserId: "user_1" });
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });

  it("rotates an existing managed secret", async () => {
    vi.mocked(rotateProjectEnvironmentSecret).mockResolvedValue({ id: "a".repeat(32), projectId: "project_1", name: "HT_GIT_TOKEN", fingerprint: "c".repeat(64), status: "configured", version: 2, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    const response = await PUT(new Request("http://localhost", { method: "PUT", body: JSON.stringify({ name: "HT_GIT_TOKEN", value: "new-secret" }), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(200);
    expect(rotateProjectEnvironmentSecret).toHaveBeenCalledWith({ projectId: "project_1", name: "HT_GIT_TOKEN", value: "new-secret", actorUserId: "user_1" });
    expect(JSON.stringify(await response.json())).not.toContain("new-secret");
  });

  it("blocks direct Git credential rotation once the repository wizard owns the configuration", async () => {
    vi.mocked(getProjectRepository).mockResolvedValue({ configuration: { authMode: "project_token" } } as never);

    const response = await PUT(new Request("http://localhost", { method: "PUT", body: JSON.stringify({ name: "HT_GIT_TOKEN", value: "new-secret" }), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ projectId: "project_1" }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "repository_credential_managed" });
    expect(rotateProjectEnvironmentSecret).not.toHaveBeenCalled();
  });
});
