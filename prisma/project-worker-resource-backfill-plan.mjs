function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function legacyResource(binding) {
  if (!isRecord(binding.workerBranchPolicy)) return null;
  if (typeof binding.workerPoolId !== "string" || !/^[a-f0-9]{32}$/u.test(binding.workerPoolId)) return null;
  if (typeof binding.workerRepositoryUrl !== "string" || binding.workerRepositoryUrl.length === 0 || binding.workerRepositoryUrl.length > 1024) return null;
  const branches = binding.workerBranchPolicy.allowedBranches;
  if (!Array.isArray(branches) || branches.length === 0 || branches.some((branch) => typeof branch !== "string")) return null;
  return {
    workerPoolId: binding.workerPoolId,
    workerRepositoryUrl: binding.workerRepositoryUrl,
    workerBranchPolicy: { allowedBranches: [...branches] },
  };
}

function fingerprint(resource) {
  return JSON.stringify([resource.workerPoolId, resource.workerRepositoryUrl, resource.workerBranchPolicy]);
}

export function planProjectWorkerResourceBackfill(input) {
  const bindingsByProject = new Map();
  for (const binding of input.bindings) {
    if (!bindingsByProject.has(binding.projectId)) bindingsByProject.set(binding.projectId, []);
    bindingsByProject.get(binding.projectId).push(binding);
  }
  const updates = [];
  const warnings = [];
  for (const project of input.projects) {
    if (project.workerPoolId !== null || project.workerRepositoryUrl !== null || project.workerBranchPolicy !== null) continue;
    const resources = (bindingsByProject.get(project.id) ?? []).map(legacyResource).filter(Boolean);
    if (resources.length === 0) continue;
    const distinct = new Map(resources.map((resource) => [fingerprint(resource), resource]));
    if (distinct.size !== 1) {
      warnings.push({ id: project.id, code: "conflicting_legacy_worker_resources" });
      continue;
    }
    updates.push({ id: project.id, version: project.version, ...resources[0] });
  }
  return { updates, warnings };
}
