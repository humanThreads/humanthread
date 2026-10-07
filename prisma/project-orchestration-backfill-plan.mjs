export function planProjectOrchestrationBackfill(input) {
  const existingStageIds = new Set(input.stages.map((stage) => stage.id));
  const existingMilestoneIds = new Set(input.milestones.map((milestone) => milestone.id));
  const projects = [];
  const stages = [];
  const milestones = [];
  const tasks = [];
  const skipped = [];
  const errors = [];

  for (const project of input.projects) {
    const stageId = `stage:legacy:${project.id}`;
    const milestoneId = `milestone:legacy:${project.id}`;
    if (project.status && project.version) skipped.push(`project:${project.id}`);
    else projects.push({ projectId: project.id, status: "active", version: 1 });

    if (existingStageIds.has(stageId)) skipped.push(stageId);
    else stages.push({
      id: stageId,
      projectId: project.id,
      key: "legacy_delivery",
      name: "Legacy Delivery",
      status: "active",
      sortOrder: 0,
      entryCriteria: {},
      exitCriteria: {},
      version: 1,
    });
    if (existingMilestoneIds.has(milestoneId)) skipped.push(milestoneId);
    else milestones.push({
      id: milestoneId,
      projectId: project.id,
      stageId,
      name: "Legacy Backlog",
      status: "active",
      requiredCheckPolicy: {},
      version: 1,
    });
  }

  const projectIds = new Set(input.projects.map((project) => project.id));
  for (const task of input.tasks) {
    if (!projectIds.has(task.projectId)) {
      errors.push({ taskId: task.id, message: "Task project is missing" });
    } else if (task.milestoneId) {
      skipped.push(`task:${task.id}`);
    } else {
      tasks.push({ taskId: task.id, milestoneId: `milestone:legacy:${task.projectId}` });
    }
  }

  return { projects, stages, milestones, tasks, skipped, errors };
}

export function summarizeProjectOrchestrationBackfill(plan) {
  return {
    projects: plan.projects.length,
    stages: plan.stages.length,
    milestones: plan.milestones.length,
    tasks: plan.tasks.length,
    skipped: plan.skipped.length,
    errors: plan.errors.length,
  };
}
