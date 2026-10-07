import { describe, expect, it, vi } from "vitest";
import {
  consumeLoopActionApproval,
  effectAutomationAction,
  markLoopEffectUnknown,
  matchLoopEffectGrant,
  pauseLoopEffectForApproval,
  prepareLoopEffect,
  recordLoopEffectReceipt,
  type EffectRecord,
  type LoopEffectDependencies,
} from "./loop-effect-commands";

const now = new Date("2026-07-30T13:00:00.000Z");

function input(overrides: Record<string, unknown> = {}) {
  return {
    id: "effect_1",
    commandId: "effect:prepare:1",
    agentRunId: "agent_run_1",
    workerId: "local-worker:device_1",
    deviceId: "device_1",
    leaseGeneration: 7,
    loopRunId: "loop_run_1",
    nodeRunId: "node_run_1",
    attemptId: "attempt_1",
    operationType: "email.send",
    requestFingerprint: "request_hash_1",
    request: { to: "user@example.com", subject: "Hello" },
    now,
    ...overrides,
  };
}

function dependencies(effect: Partial<EffectRecord> | null = null) {
  let storedEffect: EffectRecord | null = effect
    ? {
        ...effect,
        id: effect.id ?? "effect_1",
        effectKey: "",
        loopRunId: effect.loopRunId ?? "loop_run_1",
        nodeRunId: effect.nodeRunId ?? "node_run_1",
        attemptId: effect.attemptId ?? "attempt_1",
        operationType: effect.operationType ?? "email.send",
        requestFingerprint: effect.requestFingerprint ?? "request_hash_1",
        status: effect.status ?? "prepared",
      }
    : null;
  let storedResolution: { status: string; resultFingerprint: string | null; providerReceipt: string } | null = null;
  return {
    authorize: vi.fn().mockImplementation(async (candidate: ReturnType<typeof input>) => {
      const expected = input();
      for (const field of ["agentRunId", "workerId", "deviceId", "leaseGeneration", "loopRunId", "nodeRunId", "attemptId"] as const) {
        if (candidate[field] !== expected[field]) {
          throw Object.assign(new Error("stale"), { code: "stale_lease" });
        }
      }
    }),
    loadEffect: vi.fn().mockImplementation(async (effectKey: string) => (
      storedEffect ? { ...storedEffect, effectKey } : null
    )),
    createEffect: vi.fn().mockImplementation(async (
      candidate: Parameters<LoopEffectDependencies["createEffect"]>[0],
    ) => {
      storedEffect = {
        ...candidate,
        status: "prepared",
        effectKey: candidate.effectKey,
      };
      return storedEffect;
    }),
    resolveEffect: vi.fn().mockImplementation(async (candidate: Record<string, unknown>) => {
      const resolution = {
        status: String(candidate.status),
        resultFingerprint: typeof candidate.resultFingerprint === "string" ? candidate.resultFingerprint : null,
        providerReceipt: JSON.stringify(candidate.providerReceipt ?? null),
      };
      if (storedResolution && JSON.stringify(storedResolution) !== JSON.stringify(resolution)) {
        throw Object.assign(new Error("conflict"), { code: "validation_failed" });
      }
      storedResolution = resolution;
    }),
  };
}

describe("loop effect commands", () => {
  it("matches only a live grant with the exact operation and network target", () => {
    const grant = {
      id: "grant_1",
      projectId: "project_1",
      status: "active",
      scope: {
        operationTypes: ["email.send"],
        networkTargets: ["api.mail.test"],
      },
      expiresAt: new Date("2026-07-30T14:00:00.000Z"),
      revokedAt: null,
    };

    expect(matchLoopEffectGrant({
      grantIds: ["grant_1"],
      grants: [grant],
      projectId: "project_1",
      operationType: "email.send",
      networkTarget: "api.mail.test",
      now,
    })).toBe("grant_1");
    expect(matchLoopEffectGrant({
      grantIds: ["grant_1"],
      grants: [grant],
      projectId: "project_1",
      operationType: "email.send",
      networkTarget: "api.other.test",
      now,
    })).toBeNull();
    expect(matchLoopEffectGrant({
      grantIds: ["grant_1"],
      grants: [grant],
      projectId: "project_1",
      operationType: "email.send",
      now,
    })).toBeNull();
    expect(matchLoopEffectGrant({
      grantIds: ["grant_1"],
      grants: [{ ...grant, revokedAt: now }],
      projectId: "project_1",
      operationType: "email.send",
      networkTarget: "api.mail.test",
      now,
    })).toBeNull();
  });

  it("returns the existing reservation for a duplicate effect fingerprint", async () => {
    const deps = dependencies();
    const first = await prepareLoopEffect(input(), deps);
    const duplicate = await prepareLoopEffect(input(), deps);

    expect(duplicate).toEqual(first);
    expect(first).toEqual({
      effectKey: expect.stringMatching(/^effect:/u),
      status: "prepared",
      providerIdempotencyKey: expect.stringMatching(/^effect:/u),
      execute: true,
    });
    expect(deps.createEffect).toHaveBeenCalledOnce();
    expect(deps.loadEffect).toHaveBeenCalledTimes(2);
  });

  it("rejects a different request fingerprint for an existing logical effect", async () => {
    const deps = dependencies();
    await prepareLoopEffect(input(), deps);

    await expect(prepareLoopEffect(input({ requestFingerprint: "request_hash_other" }), deps))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(deps.createEffect).toHaveBeenCalledOnce();
  });

  it.each([
    ["agentRunId", "agent_run_other"],
    ["workerId", "local-worker:other"],
    ["deviceId", "device_other"],
    ["leaseGeneration", 8],
    ["loopRunId", "loop_run_other"],
    ["nodeRunId", "node_run_other"],
    ["attemptId", "attempt_other"],
  ])("rejects a reservation when %s does not match the active assignment", async (field, value) => {
    const deps = dependencies();
    await expect(prepareLoopEffect(input({ [field]: value }), deps)).rejects.toMatchObject({
      code: "stale_lease",
    });
    expect(deps.createEffect).not.toHaveBeenCalled();
  });

  it("does not dispatch an already terminal reservation", async () => {
    const deps = dependencies({
      status: "succeeded",
      requestFingerprint: "request_hash_1",
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      attemptId: "attempt_1",
    });

    const result = await prepareLoopEffect(input(), deps);

    expect(result.execute).toBe(false);
    expect(result.status).toBe("succeeded");
  });

  it("makes an identical receipt retry idempotent and rejects conflicting content", async () => {
    const deps = dependencies({ status: "prepared" });
    const receipt = {
      ...input(),
      effectKey: "effect:key_1",
      status: "succeeded" as const,
      providerReceipt: { providerId: "message_1" },
      resultFingerprint: "result_hash_1",
    };

    await expect(recordLoopEffectReceipt(receipt, deps)).resolves.toEqual({
      effectKey: "effect:key_1",
      status: "succeeded",
    });
    await expect(recordLoopEffectReceipt(receipt, deps)).resolves.toEqual({
      effectKey: "effect:key_1",
      status: "succeeded",
    });
    await expect(recordLoopEffectReceipt({ ...receipt, resultFingerprint: "different" }, deps))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(deps.resolveEffect).toHaveBeenCalledTimes(3);
  });

  it("rejects a receipt that does not match the reserved operation request", async () => {
    const deps = dependencies({ status: "prepared" });

    await expect(recordLoopEffectReceipt({
      ...input({ requestFingerprint: "request_hash_other" }),
      effectKey: "effect:key_1",
      status: "succeeded",
      providerReceipt: { providerId: "message_1" },
    }, deps)).rejects.toMatchObject({ code: "validation_failed" });
    expect(deps.resolveEffect).not.toHaveBeenCalled();
  });

  it("rejects oversized requests and credential-shaped receipts before persistence", async () => {
    const deps = dependencies();
    await expect(prepareLoopEffect(input({
      request: { body: "x".repeat(64 * 1_024) },
    }), deps)).rejects.toMatchObject({ code: "validation_failed" });
    expect(deps.createEffect).not.toHaveBeenCalled();

    await expect(recordLoopEffectReceipt({
      ...input(),
      effectKey: "effect:key_1",
      status: "succeeded",
      providerReceipt: { accessToken: "secret-value" },
    }, deps)).rejects.toMatchObject({ code: "validation_failed" });
    expect(deps.resolveEffect).not.toHaveBeenCalled();
  });

  it("records unknown outcomes as reconciliation_required", async () => {
    const deps = dependencies({ status: "prepared" });
    await expect(markLoopEffectUnknown({
      ...input(),
      effectKey: "effect:key_1",
      reason: "connection dropped after dispatch",
    }, deps)).resolves.toEqual({
      effectKey: "effect:key_1",
      status: "reconciliation_required",
    });
    expect(deps.resolveEffect).toHaveBeenCalledWith(expect.objectContaining({
      status: "reconciliation_required",
    }));
    expect(deps.resolveEffect).not.toHaveBeenCalledWith(expect.objectContaining({
      providerReceipt: expect.anything(),
    }));
  });

  it.each([
    ["deny", "policy_denied"],
    ["require_approval", "approval_required"],
  ] as const)("blocks %s before reserving an external effect", async (outcome, code) => {
    const deps = dependencies();
    deps.authorize.mockResolvedValue({
      outcome,
      reasonCode: outcome === "deny" ? "production_target_denied" : "automation_grant_scope_miss",
      matchedGrantId: null,
      actionFingerprint: "sha256:effect",
    });

    await expect(prepareLoopEffect(input(), deps)).rejects.toMatchObject({ code });
    expect(deps.loadEffect).not.toHaveBeenCalled();
    expect(deps.createEffect).not.toHaveBeenCalled();
  });

  it("persists an exact-action wait before returning approval_required", async () => {
    const deps = {
      ...dependencies(),
      waitForApproval: vi.fn().mockResolvedValue({
        approvalId: "approval:effect_1",
        status: "waiting_approval" as const,
      }),
    };
    const decision = {
      outcome: "require_approval" as const,
      reasonCode: "automation_grant_scope_miss",
      matchedGrantId: null,
      actionFingerprint: "sha256:effect",
    };
    deps.authorize.mockResolvedValue(decision);

    await expect(prepareLoopEffect(input(), deps)).rejects.toMatchObject({
      code: "approval_required",
      actionFingerprint: "sha256:effect",
      approvalId: "approval:effect_1",
    });

    expect(deps.waitForApproval).toHaveBeenCalledWith(input(), decision);
    expect(deps.loadEffect).not.toHaveBeenCalled();
    expect(deps.createEffect).not.toHaveBeenCalled();
  });

  it("atomically cancels the active attempt and opens a runtime safety wait", async () => {
    const tx = {
      agentRun: {
        findUnique: vi.fn().mockResolvedValue({
          projectId: "project_1",
          loopRunId: "loop_run_1",
          loopNodeRunId: "node_run_1",
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      loopNodeAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      loopNodeRun: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      loopRun: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      approvalRequest: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async ({ data }) => data),
      },
    };
    const transaction = async <T>(
      callback: (transaction: typeof tx) => Promise<T>,
    ): Promise<T> => callback(tx);
    const db = { $transaction: transaction };
    const decision = {
      outcome: "require_approval" as const,
      reasonCode: "automation_grant_scope_miss",
      matchedGrantId: null,
      actionFingerprint: "sha256:effect",
    };

    await expect(pauseLoopEffectForApproval(input(), decision, db)).resolves.toEqual({
      approvalId: expect.stringMatching(/^approval:/u),
      status: "waiting_approval",
    });

    expect(tx.agentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "agent_run_1",
        workerId: "local-worker:device_1",
        leaseGeneration: 7,
      }),
      data: expect.objectContaining({
        status: "cancelled",
        exitReason: "runtime_safety_approval_required",
        leaseExpiresAt: now,
      }),
    }));
    expect(tx.loopNodeAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "attempt_1", agentRunId: "agent_run_1", status: "running" },
      data: expect.objectContaining({ status: "cancelled", finishedAt: now }),
    }));
    expect(tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "node_run_1", loopRunId: "loop_run_1", status: "running" },
      data: expect.objectContaining({ status: "waiting_approval", waitingReason: "runtime_safety" }),
    }));
    expect(tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "loop_run_1", status: "running" },
      data: expect.objectContaining({ status: "waiting", statusReason: "runtime_safety" }),
    }));
    expect(tx.approvalRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project_1",
        loopRunId: "loop_run_1",
        loopNodeRunId: "node_run_1",
        agentRunId: "agent_run_1",
        type: "loop_runtime_safety",
        status: "pending",
        requestPayload: expect.objectContaining({
          actionFingerprint: "sha256:effect",
          effectId: "effect_1",
        }),
      }),
    });
  });

  it("atomically consumes one exact runtime approval across attempt retries", async () => {
    const grantPayload = {
      kind: "one_time_action",
      approvalId: "approval:effect",
      actionFingerprint: "sha256:effect",
      expiresAt: "2026-07-30T14:00:00.000Z",
      consumedAt: null,
    };
    const tx = {
      approvalRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: "approval:effect",
          loopRunId: "loop_run_1",
          loopNodeRunId: "node_run_1",
          type: "loop_runtime_safety",
          status: "approved",
          requestPayload: {
            actionFingerprint: "sha256:effect",
            actionKey: "effect-action:stable",
          },
          grantPayload,
          expiresAt: new Date("2026-07-30T12:30:00.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const transaction = async <T>(
      callback: (transaction: typeof tx) => Promise<T>,
    ): Promise<T> => callback(tx);

    await expect(consumeLoopActionApproval({
      assignment: {
        loopRunId: "loop_run_1",
        nodeRunId: "node_run_1",
      },
      actionFingerprint: "sha256:effect",
      actionKey: "effect-action:stable",
      now,
    }, { $transaction: transaction })).resolves.toEqual({ approvalId: "approval:effect" });

    expect(tx.approvalRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: "approval:effect",
        status: "approved",
        grantPayload: { equals: grantPayload },
      },
      data: {
        grantPayload: {
          ...grantPayload,
          actionKey: "effect-action:stable",
          consumedAt: now.toISOString(),
        },
      },
    });
  });

  it("rejects a one-time approval with a malformed grant expiry", async () => {
    const tx = {
      approvalRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: "approval:effect",
          loopRunId: "loop_run_1",
          loopNodeRunId: "node_run_1",
          type: "loop_runtime_safety",
          status: "approved",
          requestPayload: {
            actionFingerprint: "sha256:effect",
            actionKey: "effect-action:stable",
          },
          grantPayload: {
            kind: "one_time_action",
            approvalId: "approval:effect",
            actionFingerprint: "sha256:effect",
            expiresAt: "not-a-date",
            consumedAt: null,
          },
          expiresAt: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const transaction = async <T>(
      callback: (transaction: typeof tx) => Promise<T>,
    ): Promise<T> => callback(tx);

    await expect(consumeLoopActionApproval({
      assignment: { loopRunId: "loop_run_1", nodeRunId: "node_run_1" },
      actionFingerprint: "sha256:effect",
      actionKey: "effect-action:stable",
      now,
    }, { $transaction: transaction })).resolves.toBeNull();
    expect(tx.approvalRequest.updateMany).not.toHaveBeenCalled();
  });

  it("treats a provider receipt as reporting an existing effect, not a new grant action", () => {
    const assignment = {
      spaceId: "space_1",
      projectId: "project_1",
      bindingId: "binding_1",
      nodeKey: "code",
      workerId: "local-worker:device_1",
      agentProfileId: "profile_1",
    };
    const prepareInput = input();
    const receiptInput = {
      commandId: prepareInput.commandId,
      agentRunId: prepareInput.agentRunId,
      workerId: prepareInput.workerId,
      deviceId: prepareInput.deviceId,
      leaseGeneration: prepareInput.leaseGeneration,
      loopRunId: prepareInput.loopRunId,
      nodeRunId: prepareInput.nodeRunId,
      attemptId: prepareInput.attemptId,
      operationType: prepareInput.operationType,
      requestFingerprint: prepareInput.requestFingerprint,
      now: prepareInput.now,
    };

    expect(effectAutomationAction({ input: input(), assignment })).toMatchObject({
      requiresUserGrant: true,
      workspaceAccess: "none",
      workspaceBindingId: null,
      relativePath: null,
      workspaceContained: null,
    });
    expect(effectAutomationAction({
      input: {
        ...receiptInput,
        effectKey: "effect:key_1",
        status: "succeeded" as const,
        providerReceipt: { providerId: "message_1" },
      },
      assignment,
    }).requiresUserGrant).toBe(false);
  });
});
