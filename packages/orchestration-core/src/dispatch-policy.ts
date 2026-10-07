type ReadyTask = { id: string; priority: number; resourceKeys: string[]; createdAt: Date };

export function selectDispatchBatch(input: { readyTasks: ReadyTask[]; activeRuns: Array<{ taskId: string }>; resourceLocks: Array<{ resourceKey: string }>; projectPolicy: { maxConcurrentRuns: number } }): ReadyTask[] {
  const capacity = Math.max(0, input.projectPolicy.maxConcurrentRuns - input.activeRuns.length);
  const activeTaskIds = new Set(input.activeRuns.map((run) => run.taskId));
  const reserved = new Set(input.resourceLocks.map((lock) => lock.resourceKey));
  const selected: ReadyTask[] = [];
  for (const task of [...input.readyTasks].sort((left, right) => left.priority - right.priority || left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))) {
    if (selected.length >= capacity) break;
    if (activeTaskIds.has(task.id) || task.resourceKeys.some((key) => reserved.has(key))) continue;
    selected.push(task);
    task.resourceKeys.forEach((key) => reserved.add(key));
  }
  return selected;
}
