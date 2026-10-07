export function buildTaskCenterHref(queryString: string, taskId?: string) {
  if (taskId) return `/tasks/${encodeURIComponent(taskId)}`;
  const query = new URLSearchParams(queryString);
  query.delete("taskId");
  const serialized = query.toString();
  return serialized ? `/tasks?${serialized}` : "/tasks";
}
