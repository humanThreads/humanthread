import { describe, expect, it } from "vitest";

import {
  deviceRuntimeProfileUpsertRequestSchema,
  desktopAgentRuntimeCollectionResponseSchema,
  desktopAgentRuntimeMutationResponseSchema,
  desktopAgentMutationResponseSchema,
  desktopApprovalDecisionRequestSchema,
  desktopLoopCommandRequestSchema,
  desktopLoopInteractionConfirmRequestSchema,
  desktopLoopInteractionDecisionRequestSchema,
  desktopLoopInteractionMessageRequestSchema,
  desktopLoopInteractionMutationResponseSchema,
} from "./agents";

describe("desktop Agent command contracts", () => {
  it("accepts secret-free runtime readiness and rejects executable paths", () => {
    const request = {
      commandId: "runtime:update:1",
      expectedVersion: 2,
      provider: "codex",
      label: "Codex CLI",
      status: "ready",
      capabilities: ["workspace", "commands"],
      validatedAt: "2026-07-31T08:00:00.000Z",
    };

    expect(deviceRuntimeProfileUpsertRequestSchema.parse(request)).toEqual(request);
    expect(deviceRuntimeProfileUpsertRequestSchema.safeParse({
      ...request,
      executablePath: "/opt/homebrew/bin/codex",
    }).success).toBe(false);
    expect(deviceRuntimeProfileUpsertRequestSchema.safeParse({
      ...request,
      credential: "raw",
    }).success).toBe(false);
  });

  it("validates secret-free runtime read and mutation responses", () => {
    const runtimeProfile = {
      id: "runtime_profile_1",
      userId: "user_1",
      localDeviceId: "device_1",
      provider: "codex",
      label: "Codex CLI",
      status: "ready",
      version: 2,
      capabilities: ["commands", "workspace"],
      lastValidatedAt: "2026-07-31T08:00:00.000Z",
    };
    expect(desktopAgentRuntimeCollectionResponseSchema.parse({
      ok: true,
      data: { runtimeProfiles: [runtimeProfile] },
    }).data.runtimeProfiles).toHaveLength(1);
    expect(desktopAgentRuntimeMutationResponseSchema.parse({
      ok: true,
      data: { runtimeProfile },
    }).data.runtimeProfile.provider).toBe("codex");
    expect(desktopAgentRuntimeMutationResponseSchema.safeParse({
      ok: true,
      data: {
        runtimeProfile: {
          ...runtimeProfile,
          executablePath: "/opt/homebrew/bin/codex",
          credential: "secret",
        },
      },
    }).success).toBe(false);
  });

  it("requires an idempotency key for approval decisions", () => {
    expect(() => desktopApprovalDecisionRequestSchema.parse({
      decision: "approved",
      reason: "Reviewed",
    })).toThrow();

    expect(desktopApprovalDecisionRequestSchema.parse({
      commandId: "desktop:agent:approval:1",
      decision: "rejected",
      reason: "Scope is too broad",
    })).toEqual({
      commandId: "desktop:agent:approval:1",
      decision: "rejected",
      reason: "Scope is too broad",
    });
  });

  it("accepts only supported Loop commands", () => {
    expect(desktopLoopCommandRequestSchema.parse({
      commandId: "desktop:agent:loop:1",
      command: "pause",
      expectedVersion: 3,
    })).toEqual({
      commandId: "desktop:agent:loop:1",
      command: "pause",
      expectedVersion: 3,
    });
    expect(() => desktopLoopCommandRequestSchema.parse({
      commandId: "desktop:agent:loop:2",
      command: "retry",
      expectedVersion: 3,
    })).toThrow();
  });

  it("validates the bounded mutation result", () => {
    expect(desktopAgentMutationResponseSchema.parse({
      ok: true,
      result: { resourceType: "loop", id: "loop_1", status: "paused", version: 4 },
    }).result.status).toBe("paused");
  });

  it("validates Loop interaction message and confirmation commands", () => {
    expect(desktopLoopInteractionMessageRequestSchema.parse({
      commandId: "desktop:agent:interaction:message:1",
      message: {
        body: "Use the existing migration path.",
        answers: {},
        attachmentIds: [],
        mentionedUserIds: [],
      },
    }).message.body).toBe("Use the existing migration path.");

    expect(desktopLoopInteractionMessageRequestSchema.safeParse({
      commandId: "desktop:agent:interaction:message:legacy",
      expectedVersion: 3,
      message: {
        body: "Legacy version-fenced message.",
        answers: {},
        attachmentIds: [],
        mentionedUserIds: [],
      },
    }).success).toBe(false);

    expect(desktopLoopInteractionConfirmRequestSchema.parse({
      commandId: "desktop:agent:interaction:confirm:1",
      expectedVersion: 4,
      reason: "Requirement confirmed",
    }).reason).toBe("Requirement confirmed");
  });

  it("requires a rejection reason for Loop interaction decisions", () => {
    expect(desktopLoopInteractionDecisionRequestSchema.safeParse({
      commandId: "desktop:agent:interaction:decision:1",
      expectedVersion: 4,
      decision: "rejected",
      reason: "",
      selectedEdgeId: "edge_rejected",
    }).success).toBe(false);

    expect(desktopLoopInteractionDecisionRequestSchema.parse({
      commandId: "desktop:agent:interaction:decision:2",
      expectedVersion: 4,
      decision: "approved",
      reason: "",
      selectedEdgeId: "edge_approved",
    }).decision).toBe("approved");
  });

  it("validates the bounded Loop interaction mutation result", () => {
    expect(desktopLoopInteractionMutationResponseSchema.parse({
      ok: true,
      result: { id: "interaction_1", status: "confirmed", version: 5 },
    }).result.version).toBe(5);
  });
});
