export type WorkerResourceOwnerType = "personal" | "company";
export type CompanyResourceRole = "owner" | "admin" | "member" | "viewer";

export interface WorkerResourceScope {
  ownerType: WorkerResourceOwnerType;
  ownerUserId: string | null;
  companyId: string | null;
}

export function normalizeWorkerResourceScope(input: WorkerResourceScope): WorkerResourceScope {
  const ownerType = input.ownerType;
  const ownerUserId = input.ownerUserId?.trim() || null;
  const companyId = input.companyId?.trim() || null;
  const valid = ownerType === "personal"
    ? ownerUserId !== null && companyId === null
    : ownerUserId === null && companyId !== null;
  if (!valid) throw new Error("Worker resource scope is invalid");
  return { ownerType, ownerUserId, companyId };
}

export function workerResourceScopeWhere(scope: WorkerResourceScope): {
  ownerType: WorkerResourceOwnerType;
  ownerUserId: string | null;
  companyId: string | null;
} {
  return normalizeWorkerResourceScope(scope);
}

export function resourceScopeMatchesProject(
  resource: WorkerResourceScope,
  project: WorkerResourceScope,
): boolean {
  normalizeWorkerResourceScope(resource);
  normalizeWorkerResourceScope(project);
  if (resource.ownerType !== project.ownerType) return false;
  if (resource.ownerType === "personal") {
    return resource.ownerUserId !== null && resource.ownerUserId === project.ownerUserId;
  }
  return resource.companyId !== null && resource.companyId === project.companyId;
}

export function canManageWorkerResources(input: {
  ownerType: WorkerResourceOwnerType;
  role?: CompanyResourceRole | null;
}): boolean {
  return input.ownerType === "personal" || input.role === "owner" || input.role === "admin";
}
