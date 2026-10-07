import type { DesktopProjectDetail } from "@humanthread/workbench-client";

export function ProjectRoadmap(props: { roadmap: DesktopProjectDetail["roadmap"] }) {
  return (
    <section className="project-hub-section project-roadmap" aria-labelledby="project-roadmap-title">
      <header><h2 id="project-roadmap-title">路线图</h2><span>{props.roadmap.length} 个阶段</span></header>
      {props.roadmap.length ? (
        <div className="project-stage-list">
          {props.roadmap.map((stage, index) => (
            <article key={stage.id}>
              <div className="project-stage-index">{String(index + 1).padStart(2, "0")}</div>
              <div className="project-stage-content">
                <header>
                  <h3>{stage.name}</h3>
                  <span>{stage.status} · {stage.completedMilestones}/{stage.totalMilestones}</span>
                </header>
                <div className="project-milestone-list">
                  {stage.milestones.map((milestone) => (
                    <span key={milestone.id} data-status={milestone.status}>
                      <i aria-hidden="true" />
                      <strong>{milestone.name}</strong>
                      <small>{milestone.taskCount} 个任务</small>
                      {milestone.targetAt ? <small>{new Intl.DateTimeFormat("zh-CN").format(new Date(milestone.targetAt))}</small> : null}
                      {milestone.riskSummary ? <small>{milestone.riskSummary}</small> : null}
                      {milestone.tasks.map((task) => <small key={task.id}>{task.title} · {task.status}</small>)}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : <p className="project-section-empty">尚未规划项目阶段</p>}
    </section>
  );
}
