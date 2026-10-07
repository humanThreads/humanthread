import type { WorkbenchDashboardDetail } from "./workbench-dashboard";

export function appendTaskIdToHref(href: string, taskId: string): string {
  const separator = href.includes("?") ? "&" : "?";

  return `${href}${separator}taskId=${encodeURIComponent(taskId)}`;
}

export function getTaskContextPanelLinks(detail: WorkbenchDashboardDetail) {
  return [
    {
      label: "打开任务详情",
      href: `/tasks/${encodeURIComponent(detail.task.task.id)}`,
    },
    {
      label: "返回任务中心",
      href: "/tasks",
    },
    {
      label: "查看项目",
      href: appendTaskIdToHref(
        `/projects/${encodeURIComponent(detail.task.project.id)}`,
        detail.task.task.id,
      ),
    },
  ];
}
