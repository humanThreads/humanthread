import type { DesktopTaskDetail } from "@humanthread/workbench-client";
import { Activity } from "lucide-react";

type ActivityItem = DesktopTaskDetail["task"]["activities"][number];

export function TaskActivity(props: { activities: ActivityItem[] }) {
  return (
    <section className="task-detail-section task-activity" aria-labelledby="task-activity-title">
      <div className="task-section-heading">
        <Activity aria-hidden="true" size={16} />
        <h2 id="task-activity-title">活动记录</h2>
        <span>{props.activities.length}</span>
      </div>
      {props.activities.length ? (
        <ol className="task-activity-list">
          {props.activities.map((item) => (
            <li key={item.id}>
              <span className="task-activity-marker" aria-hidden="true" />
              <div>
                <p>{item.message ?? item.type}</p>
                <time dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleString("zh-CN")}
                </time>
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="task-section-empty">还没有活动记录</p>}
    </section>
  );
}
