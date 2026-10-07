import { PlayCircle } from "lucide-react";
import Link from "next/link";
import { prisma } from "@humanthread/db";
import { getWorkbenchCompanyFilters } from "../../lib/workbench/workbench-companies";
import { getWorkbenchShellLoginProps } from "../../lib/workbench/workbench-avatar";
import { getWorkbenchProjects } from "../../lib/workbench/workbench-projects";
import { requireWorkbenchSession } from "../../lib/workbench/workbench-route-auth";
import { WorkbenchShell } from "../components/workbench-shell";
import { EmptyState, StatusPill } from "../components/workbench-ui";

export const dynamic = "force-dynamic";
export const LOOP_RUN_LIBRARY_PAGE_TITLE = "Loop 运行工作区";

const LOOP_RUN_PAGE_SIZE = 20;

export default async function LoopRunsPage({ searchParams }: { searchParams?: Promise<{ cursor?: string }> } = {}) {
  const { session } = await requireWorkbenchSession("/loop-runs");
  const params = await searchParams;
  const [filters, projects] = await Promise.all([
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
    getWorkbenchProjects({ userId: session.context.userId }),
  ]);
  const projectIds = projects.map((project) => project.id);
  const cursor = decodeLoopRunCursor(params?.cursor);
  const runs = projectIds.length === 0 ? [] : await prisma.loopRun.findMany({
    where: {
      projectId: { in: projectIds },
      engineKind: "graph_v1",
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LOOP_RUN_PAGE_SIZE + 1,
    select: {
      id: true,
      projectId: true,
      taskId: true,
      status: true,
      createdAt: true,
      loopVersion: { select: { versionNumber: true, loopDefinition: { select: { name: true } } } },
      project: { select: { name: true } },
      task: { select: { shortId: true, title: true } },
    },
  });
  const hasMore = runs.length > LOOP_RUN_PAGE_SIZE;
  const pageRuns = runs.slice(0, LOOP_RUN_PAGE_SIZE);
  const nextCursor = hasMore && pageRuns.length > 0 ? encodeLoopRunCursor(pageRuns[pageRuns.length - 1]!) : null;

  return (
    <WorkbenchShell
      activeKey="loop-runs"
      title={LOOP_RUN_LIBRARY_PAGE_TITLE}
      subtitle="从这里进入任意任务或项目的 Loop 工作流，查看当前节点、日志、沟通和审批记录。"
      loginEmail={session.loginEmail}
      spaceFilters={filters}
      {...getWorkbenchShellLoginProps(session)}
    >
      <section aria-label="Loop 运行列表" className="mx-auto w-full max-w-6xl">
        <div className="mb-3 flex items-center justify-between border-b border-[#d0d7de] pb-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#24292f]">
            <PlayCircle aria-hidden="true" className="h-4 w-4 text-[#57606a]" />
            最近运行
          </div>
          <Link href="/loops" className="text-xs font-semibold text-[#0969da] hover:underline">返回 Loop 目录</Link>
        </div>
        {pageRuns.length === 0 ? (
          <EmptyState title="还没有 Loop 运行" description="进入项目的 Loop 设置，保存绑定后使用“立即运行”创建工作流。" />
        ) : (
          <div className="divide-y divide-[#d0d7de] border-y border-[#d0d7de] bg-white">
            {pageRuns.map((run) => (
              <article key={run.id} className="grid gap-2 px-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-semibold text-[#24292f]">{run.loopVersion?.loopDefinition.name ?? "Loop"}</h2>
                    <StatusPill tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</StatusPill>
                    {run.loopVersion ? <StatusPill>v{run.loopVersion.versionNumber}</StatusPill> : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-[#57606a]">
                    {run.project?.name ?? "未知项目"}{run.task ? ` · ${run.task.shortId ?? run.task.title}` : " · 项目级运行"}
                  </p>
                  <p className="mt-1 text-[11px] text-[#8c959f]">{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(run.createdAt)}</p>
                </div>
                <Link href={`/loop-runs/${encodeURIComponent(run.id)}`} className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-3 text-xs font-semibold text-[#24292f] hover:bg-white">
                  <PlayCircle aria-hidden="true" className="h-3.5 w-3.5" />
                  打开工作流
                </Link>
              </article>
            ))}
          </div>
        )}
        {nextCursor ? <div className="mt-3 text-center"><Link href={`/loop-runs?cursor=${encodeURIComponent(nextCursor)}`} className="inline-flex min-h-9 items-center rounded-md border border-[#d0d7de] bg-white px-3 text-sm font-semibold text-[#24292f] hover:bg-[#f6f8fa]">继续查看较早记录</Link></div> : null}
      </section>
    </WorkbenchShell>
  );
}

function encodeLoopRunCursor(run: { id: string; createdAt: Date }): string {
  return Buffer.from(JSON.stringify({ id: run.id, createdAt: run.createdAt.toISOString() }), "utf8").toString("base64url");
}

function decodeLoopRunCursor(value: string | undefined): { id: string; createdAt: Date } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { id?: unknown; createdAt?: unknown };
    const createdAt = new Date(typeof parsed.createdAt === "string" ? parsed.createdAt : "");
    return typeof parsed.id === "string" && parsed.id.length > 0 && !Number.isNaN(createdAt.getTime()) ? { id: parsed.id, createdAt } : null;
  } catch {
    return null;
  }
}

function runStatusLabel(status: string): string {
  return ({ pending: "待运行", running: "运行中", waiting: "等待处理", paused: "已暂停", completed: "已完成", failed: "失败", cancelled: "已取消", exhausted: "已耗尽" } as Record<string, string>)[status] ?? status;
}

function runStatusTone(status: string): "default" | "success" | "danger" | "warning" | "blue" {
  if (["completed"].includes(status)) return "success";
  if (["failed", "cancelled", "exhausted"].includes(status)) return "danger";
  if (["waiting", "paused"].includes(status)) return "warning";
  if (["pending", "running"].includes(status)) return "blue";
  return "default";
}
