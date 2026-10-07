import type { DesktopProjectDetail } from "@humanthread/workbench-client";
import { CircleAlert } from "lucide-react";

export function ProjectRisks(props: { risks: DesktopProjectDetail["risks"] }) {
  return (
    <section className="project-hub-section project-risks" aria-labelledby="project-risks-title">
      <header><h2 id="project-risks-title">风险与阻塞</h2><span>{props.risks.length} 项</span></header>
      {props.risks.length ? props.risks.map((risk) => (
        <article key={risk.id}>
          <CircleAlert aria-hidden="true" size={16} />
          <div><strong>{risk.name}</strong><p>{risk.summary}</p></div>
          <span>{risk.status}</span>
        </article>
      )) : <p className="project-section-empty">当前没有已记录风险</p>}
    </section>
  );
}
