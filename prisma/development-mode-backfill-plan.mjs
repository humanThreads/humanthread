export function planDevelopmentModeBackfill({ projects }) {
  const updates = [];
  const errors = [];

  for (const project of projects) {
    const values = [
      project.developmentTemplateKey,
      project.developmentTemplateVersion,
      project.developmentTemplateConfig,
      project.productionBranch,
      project.stagingBranch,
      project.releaseAgentProfileId,
    ];
    if (values.every((value) => value === null || value === undefined)) continue;
    if (values.some((value) => value === null || value === undefined)) {
      errors.push({ id: project.id, code: "partial_configuration" });
    }
  }

  return { updates, errors };
}

export function summarizeDevelopmentModeBackfill(input) {
  const result = planDevelopmentModeBackfill(input);
  return {
    processed: input.projects.length,
    updated: result.updates.length,
    skipped: input.projects.length - result.updates.length - result.errors.length,
    errors: result.errors.length,
  };
}
