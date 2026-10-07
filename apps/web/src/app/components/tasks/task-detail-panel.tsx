import { TaskDetail, type TaskDetailView } from "./task-detail";

export function TaskDetailPanel(props: {
  detail?: TaskDetailView; loading?: boolean; queryString: string; members: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>; labels: Array<{ id: string; name: string; color: string }>;
  agentProfiles: Array<{ id: string; name: string; provider: string; status: string }>;
  onDismissIntent?(): void;
}) {
  const { detail, loading = false, ...detailProps } = props;
  return <aside data-task-detail-panel="" className="absolute inset-y-0 right-0 z-30 w-full border-l border-[#d0d7de] bg-white shadow-xl md:w-[min(680px,56vw)]" aria-label="任务详情侧栏">{loading || !detail ? <div role="status" className="grid h-full place-items-center text-sm text-[#57606a]">正在加载任务...</div> : <TaskDetail key={detail.task.id} detail={detail} {...detailProps} layout="panel" />}</aside>;
}
