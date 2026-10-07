import type { DesktopTask } from "@humanthread/workbench-client";
import { CircleAlert } from "lucide-react";
import { Link } from "react-router-dom";

export const TASK_LIST_COLUMNS = [
  "任务", "状态", "负责人", "优先级", "截止时间", "项目", "子任务",
] as const;

const PRIORITY_LABELS: Record<number, string> = {
  0: "普通",
  1: "较高",
  2: "高",
  3: "紧急",
};

function dateLabel(value: string | null): string {
  if (!value) return "未安排";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" })
    .format(new Date(value));
}

export function TaskList(props: {
  tasks: DesktopTask[];
  selectedTaskIds: string[];
  onSelectionChange: (taskIds: string[]) => void;
}) {
  function toggle(taskId: string) {
    props.onSelectionChange(
      props.selectedTaskIds.includes(taskId)
        ? props.selectedTaskIds.filter((id) => id !== taskId)
        : [...props.selectedTaskIds, taskId],
    );
  }

  if (props.tasks.length === 0) {
    return <div className="task-empty-state">当前视图没有任务</div>;
  }

  return (
    <div className="task-list-wrap">
      <table aria-label="任务列表" className="task-list-table">
        <thead>
          <tr>
            <th aria-label="选择" />
            {TASK_LIST_COLUMNS.map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {props.tasks.map((task) => (
            <tr key={task.id}>
              <td>
                <input
                  aria-label={`选择${task.title}`}
                  checked={props.selectedTaskIds.includes(task.id)}
                  onChange={() => toggle(task.id)}
                  type="checkbox"
                />
              </td>
              <td>
                <div className="task-title-cell">
                  <Link to={`/tasks/${encodeURIComponent(task.id)}`}>{task.title}</Link>
                  <span>{task.labels.map((label) => label.name).join(" · ")}</span>
                </div>
              </td>
              <td><span className="task-status"><i style={{ backgroundColor: task.status.color }} />{task.status.name}</span></td>
              <td>{task.assignee?.name ?? "未指派"}</td>
              <td>{PRIORITY_LABELS[task.priority] ?? `P${task.priority}`}</td>
              <td>{task.overdue ? <strong className="task-overdue">已逾期</strong> : dateLabel(task.dueAt)}</td>
              <td>{task.project?.name ?? "无项目"}</td>
              <td>{task.childCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="task-mobile-list" data-mobile-task-list>
        {props.tasks.map((task) => (
          <article key={task.id}>
            <input
              aria-label={`选择${task.title}`}
              checked={props.selectedTaskIds.includes(task.id)}
              onChange={() => toggle(task.id)}
              type="checkbox"
            />
            <div>
              <Link to={`/tasks/${encodeURIComponent(task.id)}`}>{task.title}</Link>
              <span>{task.project?.name ?? "无项目"} · {task.assignee?.name ?? "未指派"}</span>
            </div>
            {task.blocker ? <CircleAlert aria-label="存在阻塞" size={16} /> : null}
          </article>
        ))}
      </div>
    </div>
  );
}
