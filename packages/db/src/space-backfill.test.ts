import { describe, expect, it } from "vitest";
import {
  planSpaceBackfill,
  summarizeSpaceBackfill,
} from "../../../prisma/space-backfill-plan.mjs";

describe("space backfill planning", () => {
  it("plans user, company and project space records", () => {
    const plan = planSpaceBackfill({
      users: [{ id: "user_1", name: "Alice" }],
      companies: [{ id: "company_1", name: "Acme" }],
      projects: [
        {
          id: "personal_project",
          name: "Personal",
          ownerType: "personal",
          ownerUserId: "user_1",
          companyId: null,
          spaceId: null,
        },
        {
          id: "company_project",
          name: "Company",
          ownerType: "company",
          ownerUserId: null,
          companyId: "company_1",
          spaceId: null,
        },
      ],
    });

    expect(plan.personalSpaces).toEqual([
      {
        id: "space:personal:user_1",
        ownerUserId: "user_1",
        name: "Alice 的个人空间",
      },
    ]);
    expect(plan.companySpaces).toEqual([
      {
        id: "space:company:company_1",
        companyId: "company_1",
        name: "Acme",
      },
    ]);
    expect(plan.projectAssignments).toEqual([
      {
        projectId: "personal_project",
        spaceId: "space:personal:user_1",
      },
      {
        projectId: "company_project",
        spaceId: "space:company:company_1",
      },
    ]);
    expect(plan.errors).toEqual([]);
  });

  it("keeps existing assignments and reports invalid legacy ownership", () => {
    const plan = planSpaceBackfill({
      users: [{ id: "user_1", name: "Alice" }],
      companies: [{ id: "company_1", name: "Acme" }],
      projects: [
        {
          id: "migrated",
          name: "Migrated",
          ownerType: "company",
          ownerUserId: null,
          companyId: "company_1",
          spaceId: "space:company:company_1",
        },
        {
          id: "invalid_project",
          name: "Invalid",
          ownerType: "personal",
          ownerUserId: null,
          companyId: "company_1",
          spaceId: null,
        },
      ],
    });

    expect(plan.projectAssignments).toEqual([]);
    expect(plan.skippedProjectIds).toEqual(["migrated"]);
    expect(plan.errors).toEqual([
      {
        projectId: "invalid_project",
        message: "Invalid legacy project ownership",
      },
    ]);
    expect(summarizeSpaceBackfill(plan)).toEqual({
      personalSpaces: 1,
      companySpaces: 1,
      projectAssignments: 0,
      skippedProjects: 1,
      errors: 1,
    });
  });

  it("rejects an existing assignment that conflicts with legacy ownership", () => {
    const plan = planSpaceBackfill({
      users: [{ id: "user_1", name: "Alice" }],
      companies: [{ id: "company_1", name: "Acme" }],
      projects: [
        {
          id: "conflicting_project",
          name: "Conflicting",
          ownerType: "company",
          ownerUserId: null,
          companyId: "company_1",
          spaceId: "space:personal:user_1",
        },
      ],
    });

    expect(plan.skippedProjectIds).toEqual([]);
    expect(plan.errors).toEqual([
      {
        projectId: "conflicting_project",
        message: "Project space conflicts with legacy ownership",
      },
    ]);
  });
});
