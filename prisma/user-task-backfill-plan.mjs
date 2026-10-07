const STATUS_CATEGORY = new Map([
  ["pending", "todo"],
  ["ready", "todo"],
  ["follow_up", "todo"],
  ["active", "in_progress"],
  ["running", "in_progress"],
  ["interrupted", "in_progress"],
  ["blocked", "in_progress"],
  ["verifying", "in_review"],
  ["waiting_approval", "in_review"],
  ["completed", "completed"],
  ["cancelled", "cancelled"],
]);

function present(value) {
  return value !== null && value !== undefined;
}

function firstActor(events) {
  return [...events]
    .filter((event) => event.actorUserId)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())[0]
    ?.actorUserId ?? null;
}

function legacyBlocker(task, createdById) {
  if (task.status !== "blocked") return null;
  const id = `task-blocker:legacy:${task.id}`;
  if (task.blockers.some((blocker) => blocker.id === id)) return null;
  const event = [...task.events]
    .filter((candidate) => candidate.message)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];

  return {
    id,
    taskId: task.id,
    reason: event?.message ?? "Legacy task was blocked",
    status: "active",
    createdById: event?.actorUserId ?? createdById,
    createdAt: event?.createdAt ?? task.createdAt ?? new Date(0),
  };
}

function acceptanceMode(task) {
  if (present(task.acceptanceMode)) return task.acceptanceMode;
  if (task.executionMode === "agent") return "hybrid";
  if (
    task.acceptancePolicy &&
    typeof task.acceptancePolicy === "object" &&
    Object.keys(task.acceptancePolicy).length > 0
  ) {
    return "human";
  }
  return "none";
}

function visibleTitle(task) {
  const title = task.title?.trim() ?? "";
  const stepTitle = task.stepTemplate?.title?.trim() ?? "";
  const workflowTitle = task.workflowInstance?.title?.trim() ?? "";
  return (!title || (stepTitle && title === stepTitle)) && workflowTitle
    ? workflowTitle
    : title;
}

function isMigrated(task, blockerRequired) {
  return [
    task.spaceId,
    task.createdById,
    task.statusCategory,
    task.visibility,
    task.contentMarkdown,
    task.acceptanceMode,
  ].every(present) && !blockerRequired;
}

export function planUserTaskBackfill({ tasks }) {
  const plan = {
    processed: tasks.length,
    tasks: [],
    blockers: [],
    skipped: 0,
    errors: [],
  };

  for (const task of tasks) {
    const space = task.spaceId
      ? { id: task.spaceId, type: task.project?.space?.type ?? null }
      : task.project?.space ?? null;
    const createdById = task.createdById
      ?? task.workflowInstance?.createdById
      ?? firstActor(task.events);
    const statusCategory = task.statusCategory ?? STATUS_CATEGORY.get(task.status);
    const errors = [];
    if (!space?.id) errors.push({ taskId: task.id, code: "missing_space" });
    if (!createdById) errors.push({ taskId: task.id, code: "missing_creator" });
    if (!statusCategory) errors.push({ taskId: task.id, code: "unsupported_status" });
    if (errors.length > 0) {
      plan.errors.push(...errors);
      continue;
    }

    const blocker = legacyBlocker(task, createdById);
    if (isMigrated(task, Boolean(blocker))) {
      plan.skipped += 1;
      continue;
    }

    plan.tasks.push({
      taskId: task.id,
      spaceId: space.id,
      createdById,
      statusCategory,
      visibility: task.visibility ?? (space.type === "personal" ? "private" : task.project?.id ? "project" : "company"),
      contentMarkdown: task.contentMarkdown ?? task.description ?? "",
      acceptanceMode: acceptanceMode(task),
      title: visibleTitle(task),
    });
    if (blocker) plan.blockers.push(blocker);
  }

  return plan;
}

export function summarizeUserTaskBackfill(plan) {
  return {
    processed: plan.processed,
    migrated: plan.tasks.length,
    blockers: plan.blockers.length,
    skipped: plan.skipped,
    errors: plan.errors.length,
  };
}
