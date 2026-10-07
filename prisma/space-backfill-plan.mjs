function buildPersonalSpaceId(userId) {
  return `space:personal:${userId}`;
}

function buildCompanySpaceId(companyId) {
  return `space:company:${companyId}`;
}

export function planSpaceBackfill(input) {
  const knownUsers = new Set(input.users.map((user) => user.id));
  const knownCompanies = new Set(input.companies.map((company) => company.id));
  const projectAssignments = [];
  const skippedProjectIds = [];
  const errors = [];

  for (const project of input.projects) {
    let expectedSpaceId = null;
    if (
      project.ownerType === "personal" &&
      project.ownerUserId &&
      !project.companyId &&
      knownUsers.has(project.ownerUserId)
    ) {
      expectedSpaceId = buildPersonalSpaceId(project.ownerUserId);
    } else if (
      project.ownerType === "company" &&
      project.companyId &&
      !project.ownerUserId &&
      knownCompanies.has(project.companyId)
    ) {
      expectedSpaceId = buildCompanySpaceId(project.companyId);
    } else {
      errors.push({
        projectId: project.id,
        message: "Invalid legacy project ownership",
      });
      continue;
    }

    if (project.spaceId) {
      if (project.spaceId === expectedSpaceId) {
        skippedProjectIds.push(project.id);
      } else {
        errors.push({
          projectId: project.id,
          message: "Project space conflicts with legacy ownership",
        });
      }
      continue;
    }

    projectAssignments.push({
      projectId: project.id,
      spaceId: expectedSpaceId,
    });
  }

  return {
    personalSpaces: input.users.map((user) => ({
      id: buildPersonalSpaceId(user.id),
      ownerUserId: user.id,
      name: `${user.name} 的个人空间`,
    })),
    companySpaces: input.companies.map((company) => ({
      id: buildCompanySpaceId(company.id),
      companyId: company.id,
      name: company.name,
    })),
    projectAssignments,
    skippedProjectIds,
    errors,
  };
}

export function summarizeSpaceBackfill(plan) {
  return {
    personalSpaces: plan.personalSpaces.length,
    companySpaces: plan.companySpaces.length,
    projectAssignments: plan.projectAssignments.length,
    skippedProjects: plan.skippedProjectIds.length,
    errors: plan.errors.length,
  };
}
