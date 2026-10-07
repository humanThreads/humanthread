"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  FileText,
  History,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";

import type {
  ProjectScheduledTaskDetailModel,
  ProjectScheduledTaskLoopRunProjection,
  ProjectScheduledTaskRunSummary,
  ProjectScheduledTaskSelectedRun,
} from "../../../lib/orchestration/scheduled-task-read-model";
import { LoopTimeline, type LoopTimelineItemInput } from "../loops/loop-timeline";
import { EmptyState, Panel, StatusPill, WorkbenchButton } from "../workbench-ui";

export const PROJECT_SCHEDULED_TASK_DETAIL_TABS = [
  { value: "logs", label: "运行日志" },
  { value: "report", label: "任务报告" },
] as const;

export const PROJECT_SCHEDULED_TASK_RUN_STATUS_FILTERS = [
  { value: "all", label: "全部" },
  { value: "preparing", label: "准备中" },
  { value: "running", label: "运行中" },
  { value: "waiting", label: "等待处理" },
  { value: "succeeded", label: "成功" },
  { value: "failed", label: "失败" },
  { value: "cancelled", label: "已取消" },
  { value: "blocked", label: "已阻止" },
] as const;

export type ProjectScheduledTaskDetailTab = typeof PROJECT_SCHEDULED_TASK_DETAIL_TABS[number]["value"];
export type ProjectScheduledTaskRunStatusFilter = typeof PROJECT_SCHEDULED_TASK_RUN_STATUS_FILTERS[number]["value"];

export type ProjectScheduledTaskDetailViewModel = ProjectScheduledTaskDetailModel & {
  selectedTab?: ProjectScheduledTaskDetailTab;
  runStatus?: ProjectScheduledTaskRunStatusFilter;
};

export function ProjectScheduledTaskDetail({
  projectId,
  model,
  onNavigate,
}: {
  projectId?: string;
  model: ProjectScheduledTaskDetailViewModel;
  onNavigate?: (href: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const currentSearchParams = useSearchParams();
  const selectedTab = model.selectedTab ?? "logs";
  const filteredRuns = runsForStatusFilter(model.runs, model.runStatus);
  const explicitRunId = currentSearchParams.get("run");
  const selectedRun = selectedRunForFilter({
    selectedRun: model.selectedRun,
    runs: filteredRuns,
    runStatus: model.runStatus,
    explicitRunId,
  });
  const selectorRuns = scheduledTaskRunOptions(filteredRuns, selectedRun);
  const resolvedModel: ProjectScheduledTaskDetailViewModel = {
    ...model,
    runs: filteredRuns,
    selectedRun,
    loopRun: selectedRun ? model.loopRun : null,
  };
  const tabRefs = useRef<Partial<Record<ProjectScheduledTaskDetailTab, HTMLButtonElement | null>>>({});

  function navigate(mutate: (query: URLSearchParams) => void) {
    const query = new URLSearchParams(currentSearchParams.toString());
    mutate(query);
    const href = query.size > 0 ? `${pathname}?${query.toString()}` : pathname;
    if (onNavigate) onNavigate(href);
    else router.push(href);
  }

  function selectTab(tab: ProjectScheduledTaskDetailTab, focus = false) {
    navigate((query) => query.set("tab", tab));
    if (focus) tabRefs.current[tab]?.focus();
  }

  function selectRun(runId: string) {
    navigate((query) => {
      if (runId) query.set("run", runId);
      else query.delete("run");
      query.set("tab", selectedTab);
    });
  }

  function selectRunStatus(status: ProjectScheduledTaskRunStatusFilter) {
    navigate((query) => {
      query.set("runStatus", status);
      query.set("tab", selectedTab);
    });
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? PROJECT_SCHEDULED_TASK_DETAIL_TABS.length - 1
        : event.key === "ArrowLeft"
          ? (index - 1 + PROJECT_SCHEDULED_TASK_DETAIL_TABS.length) % PROJECT_SCHEDULED_TASK_DETAIL_TABS.length
          : (index + 1) % PROJECT_SCHEDULED_TASK_DETAIL_TABS.length;
    const nextTab = PROJECT_SCHEDULED_TASK_DETAIL_TABS[nextIndex];
    if (nextTab) selectTab(nextTab.value, true);
  }

  return (
    <section className="mx-auto grid min-w-0 max-w-[1440px] gap-4">
      {projectId ? (
        <Link
          href={`/projects/${encodeURIComponent(projectId)}/scheduled-tasks`}
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-[#0969da] hover:underline"
        >
          <ArrowLeft aria-hidden="true" size={16} />返回定时任务
        </Link>
      ) : null}

      <header className="min-w-0 rounded-lg border border-[#d0d7de] bg-white">
        <div className="flex min-w-0 flex-col gap-4 border-b border-[#d8dee4] px-4 py-4 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="break-words text-xl font-semibold text-[#24292f]">{historyTaskName(resolvedModel)}</h1>
              {selectedRun ? <RunStatusPill status={selectedRun.status} /> : null}
            </div>
            <p className="mt-1 break-words text-sm leading-6 text-[#57606a]">{historyTaskDescription(resolvedModel)}</p>
          </div>
          {selectedRun?.loopRunReference ? (
            <WorkbenchButton href={`/loop-runs/${encodeURIComponent(selectedRun.loopRunReference.id)}`} size="small" variant="primary" className="w-fit shrink-0">
              进入 Loop Run <ArrowUpRight aria-hidden="true" size={14} />
            </WorkbenchButton>
          ) : null}
        </div>

        <div className="grid min-w-0 gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)] sm:px-5">
          <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-[#57606a]">
            选择运行
            <select
              aria-label="选择运行"
              value={selectedRun && selectorRuns.some((run) => run.id === selectedRun.id) ? selectedRun.id : ""}
              onChange={(event) => selectRun(event.currentTarget.value)}
              disabled={selectorRuns.length === 0}
              className="min-h-9 min-w-0 rounded-md border border-[#8c959f] bg-white px-3 py-2 text-sm font-normal text-[#24292f] outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10 disabled:bg-[#f6f8fa] disabled:text-[#6e7781]"
            >
              {selectorRuns.length === 0
                ? <option value="">暂无运行</option>
                : !selectedRun
                  ? <option value="">请选择运行</option>
                  : null}
              {selectorRuns.map((run) => (
                <option key={run.id} value={run.id}>{runOptionLabel(run)}</option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-[#57606a]">
            运行状态筛选
            <select
              aria-label="运行状态筛选"
              value={model.runStatus ?? "all"}
              onChange={(event) => selectRunStatus(event.currentTarget.value as ProjectScheduledTaskRunStatusFilter)}
              className="min-h-9 min-w-0 rounded-md border border-[#8c959f] bg-white px-3 py-2 text-sm font-normal text-[#24292f] outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
            >
              {PROJECT_SCHEDULED_TASK_RUN_STATUS_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>{filter.label}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="min-w-0 overflow-hidden rounded-lg border border-[#d0d7de] bg-white">
        <div role="tablist" aria-label="运行详情视图" className="flex min-w-0 gap-1 overflow-x-auto border-b border-[#d8dee4] bg-[#f6f8fa] p-1">
          {PROJECT_SCHEDULED_TASK_DETAIL_TABS.map((tab, index) => {
            const active = selectedTab === tab.value;
            const Icon = tab.value === "logs" ? History : FileText;
            return (
              <button
                key={tab.value}
                id={`scheduled-task-tab-${tab.value}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={active ? `scheduled-task-panel-${tab.value}` : undefined}
                tabIndex={active ? 0 : -1}
                ref={(element) => {
                  tabRefs.current[tab.value] = element;
                }}
                onClick={() => selectTab(tab.value)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                className={active
                  ? "inline-flex min-h-9 shrink-0 items-center gap-2 border-b-2 border-[#0969da] bg-white px-3 text-sm font-semibold text-[#0969da]"
                  : "inline-flex min-h-9 shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-semibold text-[#57606a] hover:bg-white hover:text-[#24292f]"}
              >
                <Icon aria-hidden="true" size={15} />{tab.label}
              </button>
            );
          })}
        </div>

        {selectedTab === "logs" ? (
          <section
            id="scheduled-task-panel-logs"
            role="tabpanel"
            aria-labelledby="scheduled-task-tab-logs"
            className="min-w-0"
          >
            <RunLogs model={resolvedModel} />
          </section>
        ) : (
          <section
            id="scheduled-task-panel-report"
            role="tabpanel"
            aria-labelledby="scheduled-task-tab-report"
            className="min-w-0"
          >
            <RunReport model={resolvedModel} />
          </section>
        )}
      </div>
    </section>
  );
}

function RunLogs({ model }: { model: ProjectScheduledTaskDetailViewModel }) {
  const run = model.selectedRun;
  if (!run && runsForStatusFilter(model.runs, model.runStatus).length > 0) {
    return <div className="p-4"><EmptyState title="没有匹配的运行" description="没有符合当前状态筛选的运行，请从运行列表中选择。" /></div>;
  }
  if (!run) return <div className="p-4"><EmptyState title="暂无运行记录" description="该定时任务还没有可展示的运行日志。" /></div>;

  const items = loopTimelineItems(run, model.loopRun);
  return (
    <div className="grid min-w-0 gap-4 p-4 sm:p-5">
      <RunFacts model={model} />
      <SnapshotSummary model={model} includeExecutionFacts={false} />
      {run.failureCode || run.failureMessage ? (
        <div role="alert" className="rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-sm text-[#cf222e]">
          <div className="font-semibold">{run.failureCode ?? "run_failed"}</div>
          <div className="mt-1 break-words">{run.failureMessage ?? "运行未提供失败摘要。"}</div>
        </div>
      ) : null}
      {model.loopRun ? (
        <div className="min-w-0 overflow-hidden rounded-md border border-[#d0d7de]">
          <LoopTimeline items={items} currentInteraction={null} />
        </div>
      ) : (
        <div className="rounded-md border border-[#d4a72c66] bg-[#fff8c5] px-3 py-3 text-sm text-[#7d4e00]">
          未创建 Loop Run，暂无可核验节点。
        </div>
      )}
    </div>
  );
}

function RunReport({ model }: { model: ProjectScheduledTaskDetailViewModel }) {
  const run = model.selectedRun;
  if (!run && runsForStatusFilter(model.runs, model.runStatus).length > 0) {
    return <div className="p-4"><EmptyState title="没有匹配的运行" description="没有符合当前状态筛选的运行，请从运行列表中选择。" /></div>;
  }
  if (!run) return <div className="p-4"><EmptyState title="暂无运行记录" description="该定时任务还没有可展示的任务报告。" /></div>;
  const report = model.report;
  const hasLedgerFailure = Boolean(run.failureCode || run.failureMessage);
  const primaryLedgerFailure = hasLedgerFailure && (!model.loopRun || report.failures.length === 0);
  return (
    <div className="grid min-w-0 gap-4 p-4 sm:p-5">
      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        <ReportMetric label="运行状态" value={runStatusLabel(report.status)} />
        <ReportMetric label="完成节点" value={`完成节点 ${report.completedNodes} / ${report.totalNodes}`} />
        <ReportMetric label="触发来源" value={triggerSourceLabel(run?.triggerSource)} />
      </div>

      <Panel title="运行时间">
        <dl className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Fact label="计划时间"><RawTime value={run.scheduledFor} empty="未安排" /></Fact>
          <Fact label="实际触发时间"><RawTime value={run.triggeredAt} empty="未触发" /></Fact>
          <Fact label="开始时间"><RawTime value={run.startedAt} empty="尚未开始" /></Fact>
          <Fact label="结束时间"><RawTime value={run.finishedAt} empty="尚未结束" /></Fact>
          <Fact label="总耗时">{formatDuration(report.durationMs)}</Fact>
        </dl>
      </Panel>

      <SnapshotSummary model={model} />

      {report.primaryArtifactRef ? (
        <Panel title="主报告">
          <a
            href={artifactHref(report.primaryArtifactRef)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-2 break-all text-sm font-semibold text-[#0969da] hover:underline"
          >
            <FileText aria-hidden="true" className="shrink-0" size={15} />主报告：{report.primaryArtifactRef}
          </a>
        </Panel>
      ) : (
        <div className="rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-3 py-3 text-sm leading-6 text-[#57606a]">
          平台未生成额外叙事报告，以下结果来自本次 Loop 事实。
        </div>
      )}

      {primaryLedgerFailure ? (
        <div role="alert" className="rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-3 py-3">
          <div className="text-xs font-semibold text-[#cf222e]">运行失败原因</div>
          <div className="mt-1 break-all text-sm font-semibold text-[#cf222e]">{run.failureCode ?? "run_failed"}</div>
          <p className="mt-1 break-words text-sm text-[#cf222e]">{run.failureMessage ?? "运行未提供失败摘要。"}</p>
        </div>
      ) : null}

      <Panel title="失败">
        {report.failures.length === 0 ? (
          hasLedgerFailure
            ? <p className="text-sm text-[#57606a]">失败原因来自运行台账，当前没有可用的 Loop 节点失败明细。</p>
            : <p className="text-sm text-[#57606a]">本次运行没有失败的 Loop 节点。</p>
        ) : (
          <ul className="grid gap-3">
            {report.failures.map((failure) => (
              <li key={`${failure.nodeKey}:${failure.code}`} className="min-w-0 rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-3 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <AlertTriangle aria-hidden="true" className="shrink-0 text-[#cf222e]" size={15} />
                  <strong className="break-all text-sm text-[#24292f]">{failure.code}</strong>
                  <span className="break-words text-xs text-[#57606a]">{failure.label}</span>
                </div>
                <p className="mt-1 break-words text-sm text-[#cf222e]">{failure.message}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="节点结果">
        {model.loopRun ? (
          <ul className="grid gap-3">
            {model.loopRun.nodes.map((node) => {
              const latest = node.attempts[node.attempts.length - 1];
              return (
                <li key={node.nodeKey} className="min-w-0 rounded-md border border-[#d8dee4] px-3 py-3">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <strong className="break-words text-sm text-[#24292f]">{node.label}</strong>
                    <RunStatusPill status={node.status} label={loopNodeStatusLabel(node.status)} />
                  </div>
                  {latest?.result ? <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-[#f6f8fa] p-2 text-xs text-[#24292f]">{boundedJson(latest.result)}</pre> : null}
                  {latest?.error ? <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-[#fff5f5] p-2 text-xs text-[#cf222e]">{boundedJson(latest.error)}</pre> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-[#57606a]">未创建 Loop Run，暂无可核验节点。</p>
        )}
      </Panel>

      {report.artifactRefs.length > 0 ? (
        <Panel title="全部产物">
          <ul className="grid gap-2">
            {report.artifactRefs.map((artifactRef) => (
              <li key={artifactRef} className="min-w-0">
                <a
                  href={artifactHref(artifactRef)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-2 break-all text-sm text-[#0969da] hover:underline"
                >
                  <FileText aria-hidden="true" className="shrink-0" size={14} />产物：{artifactRef}
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

function RunFacts({ model }: { model: ProjectScheduledTaskDetailViewModel }) {
  const run = model.selectedRun;
  if (!run) return null;
  const target = executionTarget(run.executionTargetSnapshot);
  return (
    <dl className="grid min-w-0 gap-3 rounded-md border border-[#d8dee4] bg-[#f6f8fa] p-3 sm:grid-cols-2 xl:grid-cols-3">
      <Fact label="运行状态"><RunStatusPill status={run.status} /></Fact>
      <Fact label="触发来源">{triggerSourceLabel(run.triggerSource)}</Fact>
      <Fact label="计划时间"><RawTime value={run.scheduledFor} empty="未安排" /></Fact>
      <Fact label="实际触发时间"><RawTime value={run.triggeredAt} empty="未触发" /></Fact>
      <Fact label="执行目标">{target?.displayName ?? "目标快照缺失"}</Fact>
      <Fact label="内容来源">{contentModeLabel(stringValue(taskSnapshotRecord(run).contentMode))}</Fact>
    </dl>
  );
}

function SnapshotSummary({
  model,
  includeExecutionFacts = true,
}: {
  model: ProjectScheduledTaskDetailViewModel;
  includeExecutionFacts?: boolean;
}) {
  const run = model.selectedRun;
  if (!run) return null;
  const snapshot = taskSnapshotRecord(run);
  const configuration = recordValue(snapshot.configurationSnapshot);
  const target = executionTarget(run.executionTargetSnapshot);
  const contentMode = stringValue(snapshot.contentMode);
  const contentMarkdown = contentMode === "platform" ? run.contentSnapshot : null;
  const loopVersion = model.loopRun?.definitionVersion ?? null;
  const loopVersionReference = stringValue(configuration?.loopVersionId);
  const loopScope = stringValue(configuration?.loopScope);
  const frozenLoopName = stringValue(configuration?.loopName) ?? stringValue(configuration?.loopDefinitionName);
  const loopDefinitionReference = stringValue(configuration?.loopDefinitionId);

  return (
    <Panel title="运行快照">
      <dl className="grid min-w-0 gap-x-6 gap-y-4 md:grid-cols-2">
        <SnapshotItem label="任务名称">{stringValue(snapshot.name) ?? "快照未记录"}</SnapshotItem>
        <SnapshotItem label="任务版本">{integerValue(snapshot.version) ?? "-"}</SnapshotItem>
        <SnapshotItem label="Loop">{frozenLoopName ?? (loopDefinitionReference ? `名称未冻结（${loopDefinitionReference}）` : "快照未记录")}</SnapshotItem>
        <SnapshotItem label="Loop 版本">{loopVersion === null ? "版本号未冻结" : `v${loopVersion}`}</SnapshotItem>
        <SnapshotItem label="Loop 版本引用">{loopVersionReference ?? "未记录"}</SnapshotItem>
        <SnapshotItem label="Loop 作用域">{scopeLabel(loopScope)}</SnapshotItem>
        {includeExecutionFacts ? <SnapshotItem label="执行目标">{target?.displayName ?? "目标快照缺失"}</SnapshotItem> : null}
        {includeExecutionFacts ? <SnapshotItem label="内容来源">{contentModeLabel(contentMode)}</SnapshotItem> : null}
        <SnapshotItem label="历史正文" className="md:col-span-2">
          {contentMode === "platform"
            ? contentMarkdown?.trim()
              ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[#f6f8fa] p-3 text-xs leading-5 text-[#24292f]">{contentMarkdown}</pre>
              : <span className="text-[#cf222e]">历史正文快照缺失，未使用当前任务正文替代。</span>
            : "由 Loop 或项目自行管理，不保存平台正文快照。"}
        </SnapshotItem>
      </dl>
    </Panel>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold text-[#57606a]">{label}</dt><dd className="mt-1 break-words text-sm text-[#24292f]">{children}</dd></div>;
}

function SnapshotItem({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={["min-w-0", className].filter(Boolean).join(" ")}><dt className="text-xs font-semibold text-[#57606a]">{label}</dt><dd className="mt-1 min-w-0 break-words text-sm text-[#24292f]">{children}</dd></div>;
}

function ReportMetric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-md border border-[#d8dee4] bg-white px-3 py-3"><div className="text-xs font-semibold text-[#57606a]">{label}</div><div className="mt-1 break-words text-sm font-semibold text-[#24292f]">{value}</div></div>;
}

function RawTime({ value, empty }: { value: string | null; empty: string }) {
  return value ? <time dateTime={value} className="break-all font-mono text-xs">{value}</time> : <span>{empty}</span>;
}

function RunStatusPill({ status, label }: { status: string; label?: string }) {
  const tone = status === "succeeded" || status === "completed"
    ? "success"
    : status === "failed" || status === "blocked" || status === "cancelled"
      ? "danger"
      : status === "running" || status === "waiting"
        ? "blue"
        : "warning";
  return <StatusPill tone={tone}>{label ?? runStatusLabel(status)}</StatusPill>;
}

function scheduledTaskRunOptions(
  runs: ProjectScheduledTaskRunSummary[],
  selectedRun: ProjectScheduledTaskSelectedRun | null,
): ProjectScheduledTaskRunSummary[] {
  if (!selectedRun || runs.some((run) => run.id === selectedRun.id)) return runs;
  return [{ ...selectedRun }, ...runs];
}

function runsForStatusFilter(
  runs: ProjectScheduledTaskRunSummary[],
  runStatus: ProjectScheduledTaskRunStatusFilter | undefined,
): ProjectScheduledTaskRunSummary[] {
  return !runStatus || runStatus === "all" ? runs : runs.filter((run) => run.status === runStatus);
}

function selectedRunForFilter(input: {
  selectedRun: ProjectScheduledTaskSelectedRun | null;
  runs: ProjectScheduledTaskRunSummary[];
  runStatus: ProjectScheduledTaskRunStatusFilter | undefined;
  explicitRunId: string | null;
}): ProjectScheduledTaskSelectedRun | null {
  if (!input.runStatus || input.runStatus === "all") return input.selectedRun;
  if (input.explicitRunId) {
    return input.selectedRun?.id === input.explicitRunId && input.selectedRun.status === input.runStatus
      ? input.selectedRun
      : null;
  }
  const firstMatchingRun = input.runs[0];
  return input.selectedRun?.id === firstMatchingRun?.id && input.selectedRun?.status === input.runStatus
    ? input.selectedRun
    : null;
}

function loopTimelineItems(
  run: ProjectScheduledTaskSelectedRun,
  loopRun: ProjectScheduledTaskLoopRunProjection | null,
): LoopTimelineItemInput[] {
  if (!loopRun) return [];
  const activityItems = loopRun.activities.map((activity) => ({
    id: activity.id,
    kind: activity.eventType,
    occurredAt: activity.occurredAt,
    summary: activity.summary,
    ...(activity.nodeKey ? { actorId: activity.nodeKey } : {}),
  }));
  const nodeItems = loopRun.nodes.map((node) => {
    const latest = node.attempts[node.attempts.length - 1];
    const error = recordValue(latest?.error);
    const errorCode = stringValue(error?.code);
    return {
      id: `node:${node.nodeKey}`,
      kind: `loop.node.${node.status}`,
      occurredAt: latest?.finishedAt ?? latest?.startedAt ?? run.triggeredAt,
      summary: `${node.label} · ${loopNodeStatusLabel(node.status)}${errorCode ? `：${errorCode}` : ""}`,
      status: node.status,
    };
  });
  return [...activityItems, ...nodeItems];
}

function historyTaskName(model: ProjectScheduledTaskDetailViewModel): string {
  const snapshot = model.selectedRun ? taskSnapshotRecord(model.selectedRun) : null;
  return model.selectedRun ? stringValue(snapshot?.name) ?? "任务快照缺失" : model.task.name;
}

function historyTaskDescription(model: ProjectScheduledTaskDetailViewModel): string {
  const snapshot = model.selectedRun ? taskSnapshotRecord(model.selectedRun) : null;
  return model.selectedRun ? stringValue(snapshot?.description) ?? "任务说明快照缺失" : model.task.description;
}

function taskSnapshotRecord(run: ProjectScheduledTaskSelectedRun): Record<string, unknown> {
  return recordValue(run.taskSnapshot) ?? {};
}

function executionTarget(value: unknown): { displayName: string } | null {
  const target = recordValue(value);
  const displayName = stringValue(target?.displayName);
  return displayName ? { displayName } : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function integerValue(value: unknown): number | null {
  return Number.isInteger(value) ? value as number : null;
}

function runStatusLabel(status: string): string {
  return PROJECT_SCHEDULED_TASK_RUN_STATUS_FILTERS.find((filter) => filter.value === status)?.label ?? status;
}

function loopNodeStatusLabel(status: string): string {
  if (status === "pending") return "待运行";
  if (status === "succeeded" || status === "completed") return "已完成";
  if (status === "waiting_approval" || status === "waiting") return "等待处理";
  if (status === "exhausted") return "已耗尽";
  if (status === "blocked") return "已阻止";
  if (status === "cancelled") return "已取消";
  if (status === "failed") return "失败";
  if (status === "running") return "运行中";
  return status;
}

function triggerSourceLabel(source: string | undefined): string {
  if (source === "scheduled") return "定时";
  if (source === "manual") return "手动";
  if (source === "catch_up") return "补跑";
  return source ?? "未记录";
}

function contentModeLabel(mode: string | null): string {
  if (mode === "platform") return "平台维护";
  if (mode === "loop_managed") return "项目自行管理";
  return mode ?? "未记录";
}

function scopeLabel(scope: string | null): string {
  if (scope === "project") return "项目级";
  if (scope === "task") return "任务级";
  return "未记录";
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "未完成";
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}分 ${seconds}秒` : `${seconds}秒`;
}

function runOptionLabel(run: ProjectScheduledTaskRunSummary): string {
  const time = run.scheduledFor ?? run.triggeredAt;
  return `${triggerSourceLabel(run.triggerSource)} · ${runStatusLabel(run.status)} · ${time}`;
}

function artifactHref(artifactRef: string): string {
  if (/^https?:\/\//iu.test(artifactRef) || artifactRef.startsWith("/")) return artifactRef;
  return `/${artifactRef.replace(/^\.\//u, "")}`;
}

function boundedJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2).slice(0, 4_000);
  } catch {
    return "无法序列化节点结果";
  }
}
