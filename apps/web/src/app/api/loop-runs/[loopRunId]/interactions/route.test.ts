import { beforeEach, describe, expect, it, vi } from "vitest";

import { openRequirementConversation } from "@/lib/orchestration/workflow-interaction-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@/lib/orchestration/workflow-interaction-commands", () => ({ openRequirementConversation: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ loopRunId: "loop%3Arun_1" }) };

function request(body: unknown) {
  return new Request("http://localhost/api/loop-runs/loop%3Arun_1/interactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/loop-runs/:loopRunId/interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    vi.mocked(openRequirementConversation).mockResolvedValue({
      interactionId: "interaction_1",
      messageId: "message_1",
      sequence: 1,
      version: 2,
      nodeVersion: 6,
      loopRunVersion: 8,
      loopRunProjectionVersion: 12,
    });
  });

  it("decodes the LoopRun route once and delegates a strict open command", async () => {
    const response = await POST(request({
      commandId: "cmd_open_1",
      loopNodeRunId: "node_run_1",
      message: { body: "是否只支持单项目？", answers: { rollout: ["single_project"] } },
    }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, interaction: { interactionId: "interaction_1", version: 2 } });
    expect(openRequirementConversation).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "user", id: "user_1" },
      actorUserId: "user_1",
      expectedLoopRunId: "loop:run_1",
      loopNodeRunId: "node_run_1",
      commandId: "cmd_open_1",
    }));
  });

  it("authenticates before parsing an invalid body", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValue(new Error("Workbench API authentication required"));

    const response = await POST(request({ unknown: true }), context);

    expect(response.status).toBe(401);
    expect(openRequirementConversation).not.toHaveBeenCalled();
  });

  it("rejects unknown mutation fields with HTTP 400", async () => {
    const response = await POST(request({ commandId: "cmd_open_1", loopNodeRunId: "node_run_1", extra: true, message: { body: "问题" } }), context);

    expect(response.status).toBe(400);
    expect(openRequirementConversation).not.toHaveBeenCalled();
  });

  it("maps authorization, not-found and version errors without leaking internals", async () => {
    for (const [error, status] of [
      [Object.assign(new Error("Project access denied"), { code: "authorization_denied" }), 403],
      [Object.assign(new Error("Workflow interaction not found"), { code: "not_found" }), 404],
      [Object.assign(new Error("Workflow interaction changed"), { code: "version_conflict" }), 409],
    ] as const) {
      vi.mocked(openRequirementConversation).mockRejectedValueOnce(error);
      const response = await POST(request({ commandId: "cmd_open_1", loopNodeRunId: "node_run_1", message: { body: "问题" } }), context);
      expect(response.status).toBe(status);
    }
  });

  it("rejects malformed percent-encoded route IDs without querying command services", async () => {
    const response = await POST(request({ commandId: "cmd_open_1", loopNodeRunId: "node_run_1", message: { body: "问题" } }), {
      params: Promise.resolve({ loopRunId: "%E0%A4%A" }),
    });

    expect(response.status).toBe(400);
    expect(openRequirementConversation).not.toHaveBeenCalled();
  });
});
