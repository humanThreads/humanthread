import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeLoopCallback } from "@/lib/orchestration/loop-callback-commands";
import { POST } from "./route";

vi.mock("@/lib/orchestration/loop-callback-commands", () => ({ completeLoopCallback: vi.fn() }));

const context = { params: Promise.resolve({ loopRunId: "loop_run_1", callbackId: "attempt_1" }) };

describe("POST /api/loop-runs/:loopRunId/callbacks/:callbackId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts a one-time callback credential without a Web session", async () => {
    vi.mocked(completeLoopCallback).mockResolvedValue({ completed: true, duplicate: false });

    const response = await POST(new Request("http://localhost/api/loop-runs/loop_run_1/callbacks/attempt_1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "callback_command_1", secret: "callback-secret", payload: { approved: true } }),
    }), context);

    expect(response.status).toBe(200);
    expect(completeLoopCallback).toHaveBeenCalledWith({
      loopRunId: "loop_run_1",
      callbackId: "attempt_1",
      commandId: "callback_command_1",
      secret: "callback-secret",
      payload: { approved: true },
    });
  });

  it("rejects caller-controlled actor and node identity fields", async () => {
    const response = await POST(new Request("http://localhost/api/loop-runs/loop_run_1/callbacks/attempt_1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "callback_command_1",
        secret: "callback-secret",
        payload: {},
        userId: "forged",
        nodeRunId: "forged",
      }),
    }), context);

    expect(response.status).toBe(400);
    expect(completeLoopCallback).not.toHaveBeenCalled();
  });
});
