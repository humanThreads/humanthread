import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import { createTaskCommandMetadata } from "./task-queries";

type TaskStatusCategory =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "completed"
  | "cancelled";

const STATUS_ACTIONS: Record<
  TaskStatusCategory,
  ReadonlyArray<{ command: string; label: string; tone?: "primary" | "danger" }>
> = {
  backlog: [
    { command: "move_to_todo", label: "移到待处理", tone: "primary" },
    { command: "cancel", label: "取消任务", tone: "danger" },
  ],
  todo: [
    { command: "start", label: "开始任务", tone: "primary" },
    { command: "cancel", label: "取消任务", tone: "danger" },
  ],
  in_progress: [
    { command: "submit_for_review", label: "提交验收", tone: "primary" },
    { command: "complete", label: "直接完成" },
    { command: "cancel", label: "取消任务", tone: "danger" },
  ],
  in_review: [
    { command: "accept", label: "通过验收", tone: "primary" },
    { command: "reject", label: "驳回" },
    { command: "cancel", label: "取消任务", tone: "danger" },
  ],
  completed: [{ command: "reopen", label: "重新打开" }],
  cancelled: [{ command: "reopen", label: "重新打开" }],
};

export type RunDetailTaskCommand = (
  command: string,
  payload: { commandId: string; expectedVersion: number },
) => Promise<unknown>;

export function TaskCommandBar(props: {
  capabilities: { changeStatus: boolean };
  statusCategory: TaskStatusCategory;
  version: number;
  writeEnabled: boolean;
  onCommand: RunDetailTaskCommand;
}) {
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!props.capabilities.changeStatus) return null;

  async function run(command: string) {
    setPendingCommand(command);
    setError(null);
    try {
      await props.onCommand(command, createTaskCommandMetadata(props.version));
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "任务状态更新失败");
    } finally {
      setPendingCommand(null);
    }
  }

  return (
    <div className="task-command-area">
      <div className="task-command-bar" aria-label="任务操作">
        {STATUS_ACTIONS[props.statusCategory].map((action) => (
          <button
            className={`task-command-button task-command-button-${action.tone ?? "secondary"}`}
            disabled={!props.writeEnabled || pendingCommand !== null}
            key={action.command}
            onClick={() => void run(action.command)}
            type="button"
          >
            {pendingCommand === action.command ? <LoaderCircle aria-hidden="true" size={14} /> : null}
            {action.label}
          </button>
        ))}
      </div>
      {error ? <p className="task-inline-error" role="alert">{error}</p> : null}
    </div>
  );
}
