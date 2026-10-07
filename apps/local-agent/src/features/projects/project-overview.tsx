import type { DesktopProjectDetail } from "@humanthread/workbench-client";
import { ArrowLeft, CalendarClock, Target, Users } from "lucide-react";
import { Link } from "react-router-dom";

function dateLabel(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value))
    : "未设置";
}

export function ProjectOverview(props: { detail: DesktopProjectDetail }) {
  const { project, health, resources, taskSummary } = props.detail;
  return (
    <>
      <header className="project-hub-header">
        <Link aria-label="返回项目列表" className="task-back-link" to="/projects"><ArrowLeft size={18} /></Link>
        <div>
          <span>{project.spaceLabel} · {project.status}</span>
          <h1>{project.name}</h1>
          <p>{project.description ?? "暂无项目说明"}</p>
        </div>
        <span className={`project-health project-health-${project.health}`}>{health.nextAction}</span>
      </header>
      <section className="project-objective-band" aria-labelledby="project-objective-title">
        <div><Target aria-hidden="true" size={18} /><h2 id="project-objective-title">项目目标</h2></div>
        <p>{project.objective ?? "尚未定义项目目标"}</p>
      </section>
      <section className="project-facts-band" aria-label="项目概览">
        <div><span>当前阶段</span><strong>{health.currentStageName ?? "未开始"}</strong></div>
        <div><span>任务进度</span><strong>{taskSummary.completed} / {taskSummary.total}</strong></div>
        <div><CalendarClock aria-hidden="true" size={15} /><span>目标日期</span><strong>{dateLabel(project.targetAt)}</strong></div>
        <div><Users aria-hidden="true" size={15} /><span>成员</span><strong>{resources.members}</strong></div>
      </section>
    </>
  );
}
