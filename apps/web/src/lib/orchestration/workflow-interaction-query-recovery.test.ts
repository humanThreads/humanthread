import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertCanReadProject: vi.fn().mockResolvedValue({ role: "owner" }),
  recoverLegacyLoopIntervention: vi.fn().mockResolvedValue({
    recovered: false,
    interactionId: "interaction_legacy",
    loopNodeRunId: "node_legacy",
    reasonCode: "MOBILE_SOURCE_UNAVAILABLE",
  }),
  listLoopRunInteractions: vi.fn().mockResolvedValue([]),
  prisma: {
    loopRun: { findFirst: vi.fn().mockResolvedValue({ projectId: "project_1" }) },
    project: { findUnique: vi.fn().mockResolvedValue({ managerUserId: "user_1" }) },
    task: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@humanthread/db", () => mocks);

import { readAuthorizedLoopRunInteractions } from "./workflow-interaction-query";

describe("workflow interaction query legacy recovery", () => {
  it("repairs a legacy paused retry after authorization and before reading interactions", async () => {
    await readAuthorizedLoopRunInteractions({ userId: "user_1", loopRunId: "loop_run:legacy" });

    expect(mocks.recoverLegacyLoopIntervention).toHaveBeenCalledWith(expect.objectContaining({
      loopRunId: "loop_run:legacy",
      actor: { type: "system", id: "legacy-loop-recovery" },
    }));
    expect(mocks.listLoopRunInteractions).toHaveBeenCalledWith({ loopRunId: "loop_run:legacy" });
    expect(mocks.assertCanReadProject).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
  });
});
