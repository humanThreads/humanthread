import {
  desktopReportsResponseSchema,
  type DesktopReportsResponse,
} from "@humanthread/workbench-client";
import { Activity, AlertTriangle, ArrowRight, Bot, Clock3 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { useDesktopReadModel } from "../read-first/read-model-query";
import { ReadModelError, ReadModelLoading } from "../read-first/read-model-state";
import { Pagination, usePaginatedItems } from "../../ui/pagination";

type ReportsData = DesktopReportsResponse["data"];
type ReportRange = ReportsData["range"];

function hourLabel(value: number | null): string {
  return value === null ? "数据不足" : `${value} 小时`;
}

function automationLabel(value: ReportsData["metrics"]["automationSuccess"]): string {
  return value.state === "known" ? `${value.rate}%` : value.label;
}

export function ReportsView(props: {
  data: ReportsData;
  onRangeChange(range: ReportRange): void;
}) {
  const maxCompleted = props.data.trend.state === "ready"
    ? Math.max(1, ...props.data.trend.points.map((point) => point.completed))
    : 1;
  const projectPagination = usePaginatedItems(props.data.projects, {
    initialPageSize: 20,
    resetKey: props.data.range,
  });

  return (
    <div className="reports-workspace">
      <header className="read-domain-toolbar reports-toolbar">
        <div><strong>交付健康</strong><span>生成于 {new Date(props.data.generatedAt).toLocaleString("zh-CN")}</span></div>
        <label><span>报表区间</span><select aria-label="报表区间" onChange={(event) => props.onRangeChange(event.target.value as ReportRange)} value={props.data.range}>
          <option value="7d">最近 7 天</option>
          <option value="30d">最近 30 天</option>
          <option value="90d">最近 90 天</option>
        </select></label>
      </header>

      <dl aria-label="交付指标" className="report-metrics">
        <div><dt><Activity size={15} />已完成任务</dt><dd>{props.data.metrics.completedTasks}</dd></div>
        <div><dt><AlertTriangle size={15} />逾期任务</dt><dd>{props.data.metrics.overdueTasks}</dd></div>
        <div><dt><Clock3 size={15} />阻塞中位时长</dt><dd>{hourLabel(props.data.metrics.blockerMedianAgeHours)}</dd></div>
        <div><dt><Bot size={15} />自动化成功率</dt><dd>{automationLabel(props.data.metrics.automationSuccess)}</dd></div>
      </dl>

      <div className="reports-primary-grid">
        <section aria-labelledby="report-trend-title" className="report-trend">
          <header><h2 id="report-trend-title">完成趋势</h2><span>人工等待中位时长 {hourLabel(props.data.metrics.humanWaitMedianAgeHours)}</span></header>
          {props.data.trend.state === "ready" ? (
            <div className="report-trend-bars" role="img" aria-label="交付趋势图">
              {props.data.trend.points.map((point) => (
                <div key={point.label}>
                  <span>{point.label}</span>
                  <i aria-label={`完成 ${point.completed}，阻塞 ${point.blockers}`}>
                    <span style={{ width: `${Math.min(100, Math.round((point.completed / maxCompleted) * 100))}%` }} />
                  </i>
                  <strong>{point.completed}</strong>
                  <small>阻塞 {point.blockers}</small>
                </div>
              ))}
            </div>
          ) : <p>{props.data.trend.message}</p>}
        </section>
        <section aria-labelledby="report-insights-title" className="report-insights">
          <header><h2 id="report-insights-title">需要关注</h2></header>
          {props.data.insights.map((insight) => (
            <Link data-tone={insight.tone} key={`${insight.label}:${insight.route}`} to={insight.route}>
              <span>{insight.label}<strong>{insight.count}</strong></span>
              <ArrowRight aria-hidden="true" size={15} />
            </Link>
          ))}
          {props.data.insights.length === 0 ? <p>当前没有需要关注的交付信号。</p> : null}
        </section>
      </div>

      <section aria-labelledby="report-projects-title" className="report-projects">
        <header><h2 id="report-projects-title">项目健康度</h2><span>{props.data.projects.length} 个项目</span></header>
        {props.data.projects.length > 0 ? (
          <div className="read-domain-table-wrap"><table><thead><tr><th>项目</th><th>健康度</th><th>进行中</th><th>逾期</th><th>阻塞</th></tr></thead><tbody>
            {projectPagination.items.map((project) => (
              <tr key={project.id}>
                <td><Link to={project.route}>{project.name}<small>{project.status}</small></Link></td>
                <td><span data-health={project.health}>{project.health}</span></td>
                <td>{project.openTaskCount}</td><td>{project.overdueTaskCount}</td><td>{project.blockedTaskCount}</td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <p>当前区间没有项目数据。</p>}
        <Pagination label="报表项目分页" pagination={projectPagination} />
      </section>
    </div>
  );
}

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRange = searchParams.get("range");
  const range: ReportRange = requestedRange === "7d" || requestedRange === "90d" ? requestedRange : "30d";
  const query = useDesktopReadModel({
    domain: "reports",
    endpoint: "/api/desktop/reports",
    schema: desktopReportsResponseSchema,
    parameters: { range },
  });

  if (query.isPending) return <ReadModelLoading label="正在加载报表" />;
  if (query.isError) return <ReadModelError message={query.error.message} onRetry={() => void query.refetch()} />;
  return <ReportsView data={query.data.data} onRangeChange={(nextRange) => {
    const next = new URLSearchParams(searchParams);
    next.set("range", nextRange);
    setSearchParams(next, { replace: true });
  }} />;
}
