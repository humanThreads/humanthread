import { desktopTeamResponseSchema } from "@humanthread/workbench-client";

import { usePreviewReadModel } from "../session/preview-session";
import { Pagination, usePaginatedItems } from "../ui/pagination";
import { AsyncState, PageHeader, StatusPill, SurfaceHeader, SurfacePanel } from "../ui/primitives";

export function TeamPage() {
  const query = usePreviewReadModel({
    domain: "team",
    endpoint: "/api/desktop/team",
    schema: desktopTeamResponseSchema,
  });
  const data = query.data?.data;
  const pagination = usePaginatedItems(data?.members ?? [], { initialPageSize: 20 });

  return (
    <div className="page-stack">
      <PageHeader description="成员、角色、任务队列和当前工作的统一视图。" title="团队" />
      <SurfacePanel>
        <SurfaceHeader title={data?.team?.name ?? "团队"} description={`${data?.members.length ?? 0} 位成员`} />
        <AsyncState
          empty={query.isSuccess && !data?.members.length}
          error={query.error instanceof Error ? query.error.message : null}
          label="正在加载团队"
          onRetry={() => void query.refetch()}
          status={query.isPending ? "pending" : query.isError ? "error" : "success"}
        >
          <div className="data-table-wrap"><table className="data-table"><thead><tr><th>成员</th><th>状态</th><th>队列</th><th>当前任务</th><th>最近在线</th></tr></thead><tbody>{pagination.items.map((member) => <tr key={member.id}><td><strong>{member.name}</strong><small className="table-subline">{member.email ?? "无邮箱"}</small></td><td><StatusPill tone="success">{member.status}</StatusPill></td><td>{member.queueLength}</td><td>{member.currentTask?.title ?? "暂无"}</td><td>{member.lastSeenAt ? new Date(member.lastSeenAt).toLocaleString("zh-CN") : "未知"}</td></tr>)}</tbody></table></div>
          <Pagination label="团队成员分页" pagination={pagination} />
        </AsyncState>
      </SurfacePanel>
    </div>
  );
}
