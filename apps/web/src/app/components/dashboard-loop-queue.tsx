import Link from "next/link";
import type { WorkbenchDashboardTask } from "../../lib/workbench/workbench-dashboard";

type QueueTask = WorkbenchDashboardTask;

const sections = [
  { key: "queue", title: "待推进", description: "等待你接手或启动的 Loop 步骤。", tone: "neutral" },
  { key: "running", title: "运行中", description: "Agent / Loop 正在执行的事项。", tone: "blue" },
  { key: "confirmation", title: "待确认", description: "需要人工确认后才能继续的事项。", tone: "green" },
] as const;

function sectionTasks(tasks: QueueTask[], key: (typeof sections)[number]["key"]) {
  return tasks.filter((task) => key === "running" ? task.task.status === "active" : key === "confirmation" ? task.task.status === "blocked" || task.timeBucket === "overdue" : task.task.status === "pending");
}

export function DashboardLoopQueue({ tasks, selectedSpaceKey = "all" }: { tasks: QueueTask[]; selectedSpaceKey?: string }) {
  return (
    <section aria-label="Loop 生命周期队列" className="grid gap-4">
      <div className="flex items-end justify-between gap-4 border-b border-[#d0d7de] pb-3">
        <div><p className="text-xs font-semibold text-[#57606a]">LOOP 工作流</p><h2 className="mt-1 text-xl font-semibold text-[#24292f]">按生命周期推进</h2></div>
        <Link href={`/loops?spaceKey=${encodeURIComponent(selectedSpaceKey)}`} className="text-sm font-semibold text-[#0969da]">查看全部 Loop</Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {sections.map((section) => {
          const sectionItems = sectionTasks(tasks, section.key);
          return <div key={section.key} data-loop-section={section.key} className="min-h-[190px] border border-[#d0d7de] bg-white p-4">
            <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-[#24292f]">{section.title}</h3><p className="mt-1 text-xs leading-5 text-[#57606a]">{section.description}</p></div><span className="font-mono text-lg text-[#24292f]">{sectionItems.length}</span></div>
            <div className="mt-4 grid gap-2">
              {sectionItems.length === 0 ? <p className="border-t border-dashed border-[#d0d7de] pt-3 text-xs text-[#8c959f]">暂无事项</p> : sectionItems.slice(0, 4).map((task) => <Link key={task.task.id} href={`/dashboard?spaceKey=${encodeURIComponent(selectedSpaceKey)}&taskId=${encodeURIComponent(task.task.id)}`} className="border-t border-[#d8dee4] pt-3 transition hover:text-[#0969da]"><div className="text-sm font-semibold">{task.task.title}</div><div className="mt-1 text-xs text-[#57606a]">{task.project.name} · {task.workflow.currentStepKey ?? task.timeBucketLabel}</div></Link>)}
            </div>
          </div>;
        })}
      </div>
    </section>
  );
}
