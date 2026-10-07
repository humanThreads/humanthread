import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  disableLoopBindingCommand,
  upsertLoopBindingCommand,
} from "@/lib/orchestration/loop-definition-commands";
import { readProjectLoopSettings } from "@/lib/orchestration/loop-product-read-model";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { DELETE, GET, PUT } from "./route";

vi.mock("@/lib/orchestration/loop-definition-commands", () => ({
  disableLoopBindingCommand: vi.fn(),
  upsertLoopBindingCommand: vi.fn(),
}));
vi.mock("@/lib/orchestration/loop-product-read-model", () => ({ readProjectLoopSettings: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ projectId: "project_1" }) };
const body = {
  commandId: "bind_1",
  loopDefinitionId: "loop_definition_1",
  activeVersionId: "loop_version_1",
  status: "enabled",
  triggerPolicy: { manual: true, taskEvents: ["task.completed"] },
  parameterOverrides: {},
  notificationPolicy: {},
  automationGrantIds: [],
  allowedAgentProfileIds: ["profile_codex"],
  allowedProviders: ["codex"],
};

function putRequest(value: unknown) {
  return new Request("http://localhost/api/projects/project_1/loop-bindings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

function deleteRequest(value: unknown) {
  return new Request("http://localhost/api/projects/project_1/loop-bindings", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

describe("/api/projects/:projectId/loop-bindings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_session", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  });

  it("returns bindings and available product settings through the signed actor", async () => {
    vi.mocked(readProjectLoopSettings).mockResolvedValue({
      project: { id: "project_1", spaceId: "space_1" },
      bindings: [{ id: "binding_1" }],
      definitions: [{ id: "loop_definition_1", spaceId: "space_1" }],
      grants: [{ id: "grant_1" }],
      agentProfiles: [],
      providerReadiness: [],
      workspaceBindings: [],
      triggerTypes: ["manual", "task_event"],
    });

    const response = await GET(new Request("http://localhost/api/projects/project_1/loop-bindings"), context);

    expect(response.status).toBe(200);
    expect(readProjectLoopSettings).toHaveBeenCalledWith({ userId: "user_session", projectId: "project_1" });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: [{ id: "binding_1" }],
      settings: {
        definitions: [{ id: "loop_definition_1" }],
        grants: [{ id: "grant_1" }],
        triggerTypes: ["manual", "task_event"],
      },
    });
  });

  it("maps Project authorization denial to 403", async () => {
    vi.mocked(upsertLoopBindingCommand).mockRejectedValue(new Error("Project write access denied"));

    const response = await PUT(putRequest(body), context);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "authorization_denied" });
  });

  it("forwards logical profile and provider policy to the command", async () => {
    vi.mocked(upsertLoopBindingCommand).mockResolvedValue({ id: "binding_1", version: 1 } as never);
    const response = await PUT(putRequest(body), context);
    expect(response.status).toBe(200);
    expect(upsertLoopBindingCommand).toHaveBeenCalledWith(expect.objectContaining({
      allowedAgentProfileIds: ["profile_codex"],
      allowedProviders: ["codex"],
    }));
  });

  it("forwards Worker stage configuration and rejects Project resources on a Binding", async () => {
    vi.mocked(upsertLoopBindingCommand).mockResolvedValue({ id: "binding_1", version: 1 } as never);
    const workerExecution = {
      workerStageConfigurations: {
        work: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" },
      },
    };

    const response = await PUT(putRequest({ ...body, ...workerExecution }), context);

    expect(response.status).toBe(200);
    expect(upsertLoopBindingCommand).toHaveBeenCalledWith(expect.objectContaining(workerExecution));
    const rejected = await PUT(putRequest({ ...body, ...workerExecution, workerPoolId: "a".repeat(32) }), context);
    expect(rejected.status).toBe(400);
  });

  it("maps optimistic binding conflicts to 409", async () => {
    vi.mocked(upsertLoopBindingCommand).mockRejectedValue(Object.assign(new Error("Loop binding changed"), {
      code: "version_conflict",
    }));

    const response = await PUT(putRequest({ ...body, expectedVersion: 2 }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "version_conflict" });
  });

  it("rejects unknown binding fields before command execution", async () => {
    const response = await PUT(putRequest({ ...body, bindingId: "caller_controlled" }), context);

    expect(response.status).toBe(400);
    expect(upsertLoopBindingCommand).not.toHaveBeenCalled();
  });

  it("redacts unexpected persistence failures", async () => {
    vi.mocked(readProjectLoopSettings).mockRejectedValue(new Error("database password leaked"));

    const response = await GET(new Request("http://localhost/api/projects/project_1/loop-bindings"), context);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "internal_error",
      error: "Loop request failed",
    });
  });

  it("rejects malformed disable requests before command execution", async () => {
    const response = await DELETE(deleteRequest({ commandId: "disable_1", bindingId: "binding_1" }), context);

    expect(response.status).toBe(400);
    expect(disableLoopBindingCommand).not.toHaveBeenCalled();
  });

  it("maps active task binding conflicts to 409", async () => {
    vi.mocked(disableLoopBindingCommand).mockRejectedValue(Object.assign(new Error("Task Loop binding has active Runs"), {
      code: "version_conflict",
    }));

    const response = await DELETE(deleteRequest({
      commandId: "disable_1",
      bindingId: "binding_1",
      expectedVersion: 2,
    }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "version_conflict" });
  });

  it("returns the original success for a repeated disable request", async () => {
    vi.mocked(disableLoopBindingCommand).mockResolvedValue({
      id: "binding_1",
      status: "disabled",
      version: 3,
    } as never);
    const request = { commandId: "disable_repeat_1", bindingId: "binding_1", expectedVersion: 2 };

    const first = await DELETE(deleteRequest(request), context);
    const repeated = await DELETE(deleteRequest(request), context);

    await expect(first.json()).resolves.toEqual({
      ok: true,
      result: { id: "binding_1", status: "disabled", version: 3 },
    });
    await expect(repeated.json()).resolves.toEqual({
      ok: true,
      result: { id: "binding_1", status: "disabled", version: 3 },
    });
    expect(disableLoopBindingCommand).toHaveBeenCalledTimes(2);
  });
});
