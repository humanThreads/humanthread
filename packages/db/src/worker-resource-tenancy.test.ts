import { describe, expect, it } from "vitest";

import {
  canManageWorkerResources,
  normalizeWorkerResourceScope,
  resourceScopeMatchesProject,
  type WorkerResourceScope,
} from "./worker-resource-tenancy";

describe("Worker resource tenancy", () => {
  it("matches personal resources only to their owner's personal projects", () => {
    const scope: WorkerResourceScope = {
      ownerType: "personal",
      ownerUserId: "user_owner",
      companyId: null,
    };

    expect(resourceScopeMatchesProject(scope, {
      ownerType: "personal",
      ownerUserId: "user_owner",
      companyId: null,
    })).toBe(true);
    expect(resourceScopeMatchesProject(scope, {
      ownerType: "company",
      ownerUserId: null,
      companyId: "company_1",
    })).toBe(false);
  });

  it("matches company resources only to projects in the same company", () => {
    const scope: WorkerResourceScope = {
      ownerType: "company",
      ownerUserId: null,
      companyId: "company_1",
    };

    expect(resourceScopeMatchesProject(scope, {
      ownerType: "company",
      ownerUserId: null,
      companyId: "company_1",
    })).toBe(true);
    expect(resourceScopeMatchesProject(scope, {
      ownerType: "company",
      ownerUserId: null,
      companyId: "company_2",
    })).toBe(false);
  });

  it("grants company resource management only to owners and admins", () => {
    expect(canManageWorkerResources({ ownerType: "company", role: "owner" })).toBe(true);
    expect(canManageWorkerResources({ ownerType: "company", role: "admin" })).toBe(true);
    expect(canManageWorkerResources({ ownerType: "company", role: "member" })).toBe(false);
    expect(canManageWorkerResources({ ownerType: "company", role: "viewer" })).toBe(false);
  });

  it("rejects scopes that mix personal and company ownership", () => {
    expect(() => normalizeWorkerResourceScope({
      ownerType: "company",
      ownerUserId: "user_owner",
      companyId: "company_1",
    })).toThrow("Worker resource scope is invalid");
  });
});
