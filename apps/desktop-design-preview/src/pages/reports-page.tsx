import { desktopReportsResponseSchema } from "@humanthread/workbench-client";
import { useState } from "react";

import { usePreviewReadModel } from "../session/preview-session";
import { AsyncState, PageHeader, StatusPill, SurfaceHeader, SurfacePanel } from "../ui/primitives";
import { Pagination, usePaginatedItems } from "../ui/pagination";
import { TrendChart } from "../ui/trend-chart";

type ReportRange = "7d" | "30d" | "90d";

export function ReportsPage() {
  const [range, setRange] = useState<ReportRange>("30d");
  const query = usePreviewReadModel({
    domain: "reports",
    endpoint: "/api/desktop/reports",
    parameters: { range },
    schema: desktopReportsResponseSchema,
  });
  const data = query.data?.data;
  const projectPagination = usePaginatedItems(data?.projects ?? [], { initialPageSize: 20 });

  return (
    <div className="page-stack">
      <PageHeader
        actions={(
          <div className="segmented-control" aria-label="报表范围">
            {(["7d", "30d", "90d"] as ReportRange[]).map((item) => <button aria-pressed={range === item} key={item} onClick={() => setRange(item)} type="button">{item}</button>)}
          </div>
        )}
        description="用可比较指标和趋势摘要观察交付状态。"
        title="报表"
      />
      <AsyncState
        error={query.error instanceof Error ? query.error.message : null}
        label="正在加载报表"
        onRetry={() => void query.refetch()}
        status={query.isPending ? "pending" : query.isError ? "error" : "success"}
      >
        {data ? (
          <>
            <section className="metric-strip" aria-label="交付指标">
              <div className="metric-item"><span>完成任务</span><strong>{data.metrics.completedTasks}</strong><small>当前范围</small></div>
              <div className="metric-item"><span>逾期任务</span><strong>{data.metrics.overdueTasks}</strong><small>需要跟进</small></div>
              <div className="metric-item"><span>阻塞中位时长</span><strong>{data.metrics.blockerMedianAgeHours ?? "不可用"}</strong><small>小时</small></div>
              <div className="metric-item"><span>自动化成功率</span><strong>{data.metrics.automationSuccess.state === "known" ? `${data.metrics.automationSuccess.rate}%` : "不可用"}</strong><small>{data.metrics.automationSuccess.state === "known" ? `${data.metrics.automationSuccess.succeeded} / ${data.metrics.automationSuccess.total}` : data.metrics.automationSuccess.label}</small></div>
            </section>
            <SurfacePanel>
              <SurfaceHeader title="交付趋势" description="完成与阻塞数量" />
              {data.trend.state === "ready" ? (
                <TrendChart points={data.trend.points} />
              ) : <div className="empty-state"><strong>趋势数据不足</strong><p>{data.trend.message}</p></div>}
            </SurfacePanel>
            <SurfacePanel>
              <SurfaceHeader title="项目比较" />
              <div className="data-table-wrap"><table className="data-table"><thead><tr><th>项目</th><th>健康度</th><th>开放任务</th><th>逾期</th><th>阻塞</th></tr></thead><tbody>{projectPagination.items.map((project) => <tr key={project.id}><td>{project.name}</td><td><StatusPill tone="success">{project.health}</StatusPill></td><td>{project.openTaskCount}</td><td>{project.overdueTaskCount}</td><td>{project.blockedTaskCount}</td></tr>)}</tbody></table></div>
              <Pagination label="报表项目分页" pagination={projectPagination} />
            </SurfacePanel>
          </>
        ) : null}
      </AsyncState>
    </div>
  );
}
