import { beforeEach, describe, expect, it, vi } from "vitest";

import { appendRequirementMessage } from "@/lib/orchestration/workflow-interaction-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@/lib/orchestration/workflow-interaction-commands", () => ({ appendRequirementMessage: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ loopRunId: "loop:run_1", interactionId: "interaction_1" }) };
const body = { commandId: "cmd_reply_1", message: { body: "采用 A", answers: { mode: ["a"] } } };

describe("POST /api/loop-runs/:loopRunId/interactions/:interactionId/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    vi.mocked(appendRequirementMessage).mockResolvedValue({ interactionId: "interaction_1", messageId: "message_1", sequence: 2, version: 3 });
  });

  it("returns the stored idempotent result", async () => {
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, interaction: { interactionId: "interaction_1", version: 3 } });
    expect(appendRequirementMessage).toHaveBeenCalledWith(expect.objectContaining({
      interactionId: "interaction_1",
      expectedLoopRunId: "loop:run_1",
      actor: { type: "user", id: "user_1" },
      message: { body: "采用 A", answers: { mode: ["a"] }, attachmentIds: [], mentionedUserIds: [] },
    }));
    expect(vi.mocked(appendRequirementMessage).mock.calls[0]?.[0]).not.toHaveProperty("expectedVersion");
  });

  it("maps terminal read-only and authorization errors", async () => {
    vi.mocked(appendRequirementMessage).mockRejectedValueOnce(Object.assign(new Error("Workflow interaction is read-only"), { code: "version_conflict" }));
    const terminal = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }), context);
    expect(terminal.status).toBe(409);

    vi.mocked(appendRequirementMessage).mockRejectedValueOnce(Object.assign(new Error("role denied"), { code: "authorization_denied" }));
    const denied = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }), context);
    expect(denied.status).toBe(403);
  });

  it("rejects unknown request fields", async () => {
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ ...body, extra: true }) }), context);
    expect(response.status).toBe(400);
    expect(appendRequirementMessage).not.toHaveBeenCalled();
  });

  it("rejects the removed message expectedVersion field", async () => {
    const response = await POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ ...body, expectedVersion: 2 }),
    }), context);
    expect(response.status).toBe(400);
    expect(appendRequirementMessage).not.toHaveBeenCalled();
  });
});
