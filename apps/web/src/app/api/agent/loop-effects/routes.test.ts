import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/agent/agent-auth", () => ({
  authenticateAgentRequest: vi.fn().mockResolvedValue({
    userId: "user_1",
    teamId: "team_1",
    deviceId: "device_1",
  }),
}));

vi.mock("../../../../lib/orchestration/loop-effect-commands", () => ({
  createPrismaLoopEffectDependencies: vi.fn().mockReturnValue({}),
  prepareLoopEffect: vi.fn().mockResolvedValue({
    effectKey: "effect:key_1",
    status: "prepared",
    providerIdempotencyKey: "provider:key_1",
    execute: true,
  }),
  recordLoopEffectReceipt: vi.fn().mockResolvedValue({
    effectKey: "effect:key_1",
    status: "succeeded",
  }),
}));

const common = {
  userId: "user_1",
  deviceId: "device_1",
  workerId: "local-worker:device_1",
  agentRunId: "agent_run_1",
  leaseGeneration: 7,
  loopRunId: "loop_run_1",
  nodeRunId: "node_run_1",
  attemptId: "attempt_1",
  operationType: "email.send",
};

function request(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer user_token",
      "content-type": "application/json",
      "x-agent-device-token": "device_token",
    },
    body: JSON.stringify(body),
  });
}

describe("Loop effect Agent routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("authenticates the device and prepares the leased effect", async () => {
    const { POST } = await import("./prepare/route");
    const { authenticateAgentRequest } = await import("../../../../lib/agent/agent-auth");
    const { prepareLoopEffect } = await import("../../../../lib/orchestration/loop-effect-commands");
    const response = await POST(request("/api/agent/loop-effects/prepare", {
      ...common,
      id: "effect_1",
      commandId: "effect:prepare:1",
      requestFingerprint: "request_hash_1",
      request: { to: "user@example.com" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: { effectKey: "effect:key_1", execute: true },
    });
    expect(authenticateAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user_1",
      deviceId: "device_1",
      requireAuthorizedDevice: true,
    }));
    expect(prepareLoopEffect).toHaveBeenCalledWith(expect.objectContaining({
      agentRunId: "agent_run_1",
      deviceId: "device_1",
      requestFingerprint: "request_hash_1",
    }), expect.anything());
  });

  it("uses the path effectKey when recording a receipt", async () => {
    const { POST } = await import("./[effectKey]/receipt/route");
    const { recordLoopEffectReceipt } = await import("../../../../lib/orchestration/loop-effect-commands");
    const response = await POST(request("/api/agent/loop-effects/effect%3Akey_1/receipt", {
      ...common,
      commandId: "effect:receipt:1",
      requestFingerprint: "request_hash_1",
      status: "succeeded",
      providerReceipt: { providerId: "message_1" },
      resultFingerprint: "result_hash_1",
    }), { params: Promise.resolve({ effectKey: "effect:key_1" }) });

    expect(response.status).toBe(200);
    expect(recordLoopEffectReceipt).toHaveBeenCalledWith(expect.objectContaining({
      effectKey: "effect:key_1",
      status: "succeeded",
    }), expect.anything());
  });

  it("returns forbidden when the live AutomationGrant does not authorize the effect", async () => {
    const { prepareLoopEffect } = await import("../../../../lib/orchestration/loop-effect-commands");
    vi.mocked(prepareLoopEffect).mockRejectedValueOnce(Object.assign(
      new Error("Automation grant does not authorize this external effect"),
      { code: "authorization_denied" },
    ));
    const { POST } = await import("./prepare/route");
    const response = await POST(request("/api/agent/loop-effects/prepare", {
      ...common,
      id: "effect_1",
      commandId: "effect:prepare:denied",
      requestFingerprint: "request_hash_1",
      request: { to: "user@example.com" },
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "authorization_denied",
    });
  });
});
