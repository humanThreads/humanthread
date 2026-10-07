import type { Prisma } from "@prisma/client";

type ApprovalExpiryWriter = {
  updateMany(input: {
    where: Prisma.ApprovalRequestWhereInput;
    data: Prisma.ApprovalRequestUpdateManyMutationInput;
  }): Promise<{ count: number }>;
};

/** Loop runs in these states cannot accept a human gate anymore. */
export const TERMINAL_LOOP_RUN_STATUSES = ["completed", "failed", "cancelled", "exhausted"] as const;

const terminalApprovalWhere: Prisma.ApprovalRequestWhereInput = {
  loopRun: { status: { in: [...TERMINAL_LOOP_RUN_STATUSES] } },
};

const pendingApprovalExpiryWhere = (now: Date): Prisma.ApprovalRequestWhereInput => ({
  status: "pending",
  expiresAt: { not: null, lte: now },
});

/** Persist expiry transitions before active approval projections are read. */
export async function expirePendingApprovals(input: {
  now: Date;
  scope?: Prisma.ApprovalRequestWhereInput;
  updateMany: ApprovalExpiryWriter["updateMany"];
}): Promise<{ count: number }> {
  const scoped = (where: Prisma.ApprovalRequestWhereInput): Prisma.ApprovalRequestWhereInput =>
    input.scope ? { AND: [input.scope, where] } : where;
  const deadline = await input.updateMany({
    where: scoped(pendingApprovalExpiryWhere(input.now)),
    data: { status: "expired", decidedAt: input.now, decisionReason: "审批已过期" },
  });
  const terminal = await input.updateMany({
    where: scoped({ status: "pending", ...terminalApprovalWhere }),
    data: { status: "expired", decidedAt: input.now, decisionReason: "Loop 已结束，审批自动失效" },
  });
  return { count: deadline.count + terminal.count };
}

export async function expirePendingApproval(input: {
  approvalId: string;
  now: Date;
  updateMany: ApprovalExpiryWriter["updateMany"];
}): Promise<{ count: number }> {
  return input.updateMany({
    where: { id: input.approvalId, status: "pending", OR: [
      { expiresAt: { not: null, lte: input.now } },
      terminalApprovalWhere,
    ] },
    data: { status: "expired", decidedAt: input.now, decisionReason: "审批已过期或 Loop 已结束" },
  });
}

export function buildActiveApprovalWhere(now: Date): Prisma.ApprovalRequestWhereInput {
  return {
    status: "pending",
    AND: [
      {
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      {
        OR: [
          { loopRunId: null },
          { loopRun: { status: { notIn: [...TERMINAL_LOOP_RUN_STATUSES] } } },
        ],
      },
    ],
  };
}
