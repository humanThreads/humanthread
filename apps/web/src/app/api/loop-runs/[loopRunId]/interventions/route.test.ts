import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestRuntimeIntervention } from "@/lib/orchestration/workflow-interaction-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@/lib/orchestration/workflow-interaction-commands", () => ({ requestRuntimeIntervention: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ loopRunId: "loop%3Arun_1" }) };

function request(body: unknown) {
  return new Request("http://localhost/api/loop-runs/loop%3Arun_1/interventions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/loop-runs/:loopRunId/interventions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    vi.mocked(requestRuntimeIntervention).mockResolvedValue({ interactionId: "runtime_interaction_1", status: "open", version: 1, recovered: false } as never);
  });

  it("resolves the user and LoopRun route while ignoring caller-supplied Attempt identity", async () => {
    const response = await POST(request({ commandId: "cmd_intervention_1", reason: "需要人工补充 App 源码", evidence: { issueType: "MOBILE_SOURCE_UNAVAILABLE" }, loopNodeAttemptId: "forged_attempt" }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, intervention: { interactionId: "runtime_interaction_1" } });
    expect(requestRuntimeIntervention).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "user", id: "user_1" },
      actorUserId: "user_1",
      loopRunId: "loop:run_1",
      commandId: "cmd_intervention_1",
    }));
    expect((requestRuntimeIntervention as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]).not.toHaveProperty("loopNodeAttemptId", "forged_attempt");
  });

  it("maps missing Task collaboration permission to 403", async () => {
    vi.mocked(requestRuntimeIntervention).mockRejectedValue(Object.assign(new Error("Task collaboration access denied"), { code: "authorization_denied" }));
    const response = await POST(request({ commandId: "cmd_intervention_1", reason: "人工介入" }), context);
    expect(response.status).toBe(403);
  });
});
