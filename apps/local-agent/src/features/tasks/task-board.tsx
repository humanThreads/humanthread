import type { DesktopTask } from "@humanthread/workbench-client";
import { ArrowRight, CircleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { createTaskCommandMetadata, type TaskGroup } from "./task-queries";

const STATUS_COLUMNS = [
  ["backlog", "待规划"],
  ["todo", "待处理"],
  ["in_progress", "进行中"],
  ["in_review", "待验收"],
  ["completed", "已完成"],
  ["cancelled", "已取消"],
] as const;

const PRIORITY_LABELS: Record<number, string> = {
  0: "普通",
  1: "较高",
  2: "高",
  3: "紧急",
};

const NEXT_ACTION: Partial<Record<DesktopTask["statusCategory"], {
  command: string;
  label: string;
}>> = {
  backlog: { command: "move_to_todo", label: "移动到 待处理" },
  todo: { command: "start", label: "移动到 进行中" },
  in_progress: { command: "submit_for_review", label: "移动到 待验收" },
  in_review: { command: "accept", label: "移动到 已完成" },
  cancelled: { command: "reopen", label: "重新打开" },
};

export interface RunTaskCommand {
  (taskId: string, command: string, payload: {
    commandId: string;
    expectedVersion: number;
  }): Promise<void>;
}

function boardColumns(tasks: DesktopTask[], group: TaskGroup) {
  if (group === "status") {
    return STATUS_COLUMNS.map(([key, label]) => ({
      key,
      label,
      tasks: tasks.filter((task) => task.statusCategory === key),
    }));
  }

  const groups = new Map<string, { label: string; tasks: DesktopTask[] }>();
  for (const task of tasks) {
    const identity = group === "assignee"
      ? { key: task.assignee?.id ?? "unassigned", label: task.assignee?.name ?? "未指派" }
      : group === "project"
        ? { key: task.project?.id ?? "no_project", label: task.project?.name ?? "无项目" }
        : { key: String(task.priority), label: PRIORITY_LABELS[task.priority] ?? `P${task.priority}` };
    const current = groups.get(identity.key);
    groups.set(identity.key, {
      label: identity.label,
      tasks: [...(current?.tasks ?? []), task],
    });
  }
  return [...groups].map(([key, value]) => ({ key, ...value }));
}

export function TaskBoard(props: {
  group: TaskGroup;
  tasks: DesktopTask[];
  writeEnabled: boolean;
  runTaskCommand: RunTaskCommand;
}) {
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const columns = boardColumns(props.tasks, props.group);

  async function advance(task: DesktopTask, command: string) {
    setBusyTaskId(task.id);
    setError(null);
    try {
      await props.runTaskCommand(
        task.id,
        command,
        createTaskCommandMetadata(task.version),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "任务状态更新失败");
    } finally {
      setBusyTaskId(null);
    }
  }

  return (
    <div className="task-board-wrap">
      {error ? <p className="task-command-error" role="alert">{error}</p> : null}
      <div aria-label="任务看板" className="task-board" role="region">
        {columns.map(({ key, label, tasks }) => {
          return (
            <section aria-label={label} className="task-board-column" key={key} role="group">
              <header><h2>{label}</h2><span>{tasks.length}</span></header>
              <div>
                {tasks.map((task) => {
                  const action = NEXT_ACTION[task.statusCategory];
                  return (
                    <article className="task-board-card" key={task.id}>
                      <Link to={`/tasks/${encodeURIComponent(task.id)}`}>{task.title}</Link>
                      <p>{task.project?.name ?? "无项目"} · {task.assignee?.name ?? "未指派"}</p>
                      {task.blocker ? <span className="task-blocker"><CircleAlert aria-hidden="true" size={14} />{task.blocker.reason}</span> : null}
                      {action ? (
                        <button
                          aria-label={action.label}
                          disabled={!props.writeEnabled || busyTaskId === task.id}
                          onClick={() => void advance(task, action.command)}
                          type="button"
                        >
                          {action.label}<ArrowRight aria-hidden="true" size={14} />
                        </button>
                      ) : null}
                    </article>
                  );
                })}
                {tasks.length === 0 ? <p className="task-board-empty">暂无任务</p> : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
