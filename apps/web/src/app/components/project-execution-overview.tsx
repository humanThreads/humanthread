import { AlertTriangle, Bot, CheckCircle2, CircleDot, ShieldCheck } from "lucide-react";
import { StatusPill } from "./workbench-ui";

type Stage = { id: string; name: string; status: string; completedMilestones: number; totalMilestones: number };
type Milestone = { id: string; name: string; status: string; riskSummary?: string | null };
type ProjectTask = { id: string; title: string; status: string; priority: number };

export function ProjectExecutionOverview({
  project,
  stages,
  milestones,
  tasks,
  activeRuns,
  pendingApprovals,
}: {
  project: { name: string; objective: string | null; status: string };
  stages: Stage[];
  milestones: Milestone[];
  tasks: ProjectTask[];
  activeRuns: number;
  pendingApprovals: number;
}) {
  const readyTasks = tasks.filter((task) => task.status === "ready").length;
  return (
    <section className="border-b border-[#d0d7de] bg-white">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5">
        <div className="min-w-0 max-w-3xl">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-[#1f2328]">{project.name}</h1>
            <StatusPill tone={project.status === "active" ? "success" : "default"}>{project.status}</StatusPill>
          </div>
          <p className="mt-2 text-sm leading-6 text-[#59636e]">{project.objective ?? "尚未设置项目目标"}</p>
        </div>
      </div>
      <div className="grid border-t border-[#d8dee4] sm:grid-cols-3">
        {[
          { label: "就绪任务", value: readyTasks, icon: CircleDot },
          { label: "运行中 Agent", value: activeRuns, icon: Bot },
          { label: "待审批", value: pendingApprovals, icon: ShieldCheck },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-3 border-b border-[#d8dee4] px-5 py-4 sm:border-b-0 sm:border-r last:border-r-0">
            <item.icon className="size-4 text-[#59636e]" aria-hidden="true" />
            <div><div className="text-xs text-[#59636e]">{item.label}</div><div className="mt-0.5 text-lg font-semibold text-[#1f2328]">{item.value}</div></div>
          </div>
        ))}
      </div>
      <div className="grid border-t border-[#d8dee4] lg:grid-cols-[1.1fr_0.9fr]">
        <div className="divide-y divide-[#d8dee4] border-b border-[#d8dee4] lg:border-b-0 lg:border-r">
          {stages.map((stage) => {
            const progress = stage.totalMilestones === 0 ? 0 : Math.round(stage.completedMilestones / stage.totalMilestones * 100);
            return <div key={stage.id} className="px-5 py-4"><div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium text-[#1f2328]">{stage.name}</span><span className="text-[#59636e]">{stage.completedMilestones}/{stage.totalMilestones}</span></div><div className="mt-3 h-1.5 overflow-hidden rounded bg-[#eaeef2]"><div className="h-full bg-[#1f883d]" style={{ width: `${progress}%` }} /></div></div>;
          })}
        </div>
        <div className="divide-y divide-[#d8dee4]">
          {milestones.map((milestone) => <div key={milestone.id} className="flex items-start gap-3 px-5 py-4">{milestone.status === "at_risk" ? <AlertTriangle className="mt-0.5 size-4 text-[#bf8700]" /> : <CheckCircle2 className="mt-0.5 size-4 text-[#1a7f37]" />}<div className="min-w-0"><div className="text-sm font-medium text-[#1f2328]">{milestone.name}</div>{milestone.riskSummary ? <div className="mt-1 text-xs leading-5 text-[#59636e]">{milestone.riskSummary}</div> : null}</div></div>)}
        </div>
      </div>
    </section>
  );
}
