import { assertCanReadProject, prisma } from "@humanthread/db";

export interface WebWorkerResourceScope {
  ownerType: "personal" | "company";
  ownerUserId: string | null;
  companyId: string | null;
}

export async function resolveWorkerManagementScope(input: {
  userId: string;
  companyId?: string | null;
}): Promise<{ scope: WebWorkerResourceScope; companyRole?: "owner" | "admin" }> {
  const companyId = input.companyId?.trim() ?? "";
  if (!companyId) {
    return { scope: { ownerType: "personal", ownerUserId: input.userId, companyId: null } };
  }
  const membership = await prisma.companyMember.findFirst({
    where: { userId: input.userId, companyId, status: "active", role: { in: ["owner", "admin"] } },
    select: { role: true },
  });
  if (membership?.role !== "owner" && membership?.role !== "admin") {
    throw Object.assign(new Error("Company Worker resource management is required"), { code: "authorization_denied" });
  }
  return {
    scope: { ownerType: "company", ownerUserId: null, companyId },
    companyRole: membership.role,
  };
}

export async function resolveWorkerProjectScope(input: {
  userId: string;
  projectId: string;
}): Promise<WebWorkerResourceScope> {
  await assertCanReadProject({ userId: input.userId, projectId: input.projectId });
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { ownerType: true, ownerUserId: true, companyId: true },
  });
  if (!project || (project.ownerType !== "personal" && project.ownerType !== "company")) {
    throw Object.assign(new Error("Project Worker resource scope is unavailable"), { code: "validation_failed" });
  }
  const scope: WebWorkerResourceScope = {
    ownerType: project.ownerType,
    ownerUserId: project.ownerUserId,
    companyId: project.companyId,
  };
  const valid = scope.ownerType === "personal"
    ? Boolean(scope.ownerUserId) && scope.companyId === null
    : scope.ownerUserId === null && Boolean(scope.companyId);
  if (!valid) throw Object.assign(new Error("Project Worker resource scope is unavailable"), { code: "validation_failed" });
  return scope;
}

export async function resolveWorkerProjectManagementScope(input: {
  userId: string;
  projectId: string;
}): Promise<{ scope: WebWorkerResourceScope; companyRole?: "owner" | "admin" }> {
  const scope = await resolveWorkerProjectScope(input);
  if (scope.ownerType === "personal") return { scope };
  const membership = await prisma.companyMember.findFirst({
    where: {
      userId: input.userId,
      companyId: scope.companyId!,
      status: "active",
      role: { in: ["owner", "admin"] },
    },
    select: { role: true },
  });
  if (membership?.role !== "owner" && membership?.role !== "admin") {
    throw Object.assign(new Error("Company Worker resource management is required"), { code: "authorization_denied" });
  }
  return { scope, companyRole: membership.role };
}
