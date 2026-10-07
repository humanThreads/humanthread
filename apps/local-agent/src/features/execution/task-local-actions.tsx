import type { DesktopTaskExecution } from "@humanthread/workbench-client";
import { FolderOpen, RotateCcw, SquareTerminal } from "lucide-react";
import { useState } from "react";

import type { LocalRuntime } from "../../lib/runtime";
import type { NativeEventInput } from "../../desktop/native-events";

export function TaskLocalActions(props: {
  taskId: string;
  execution: DesktopTaskExecution;
  canExecute: boolean;
  runtime: LocalRuntime;
  reportEvent: (input: NativeEventInput) => Promise<void>;
}) {
  const [pending, setPending] = useState<"folder" | "terminal" | "restore" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);
  const executionReady = Boolean(
    props.canExecute
    && props.runtime.isNative
    && props.execution.projectId
    && props.execution.workflowInstanceId
    && props.execution.localPath,
  );

  async function openFolder() {
    const cwd = props.execution.localPath;
    if (!cwd) return;
    setPending("folder");
    setNotice(null);
    try {
      await props.runtime.openProjectPath(cwd);
      setNotice({ tone: "success", text: "已打开项目目录" });
      try {
        await props.reportEvent({
          taskId: props.taskId,
          eventType: "local_opened",
          message: "已从本地客户端打开项目目录",
          payload: { cwd },
        });
      } catch {
        setNotice({ tone: "warning", text: "目录已打开，但事件回传失败" });
      }
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "打开目录失败" });
    } finally {
      setPending(null);
    }
  }

  async function openTerminal() {
    const cwd = props.execution.localPath;
    if (!cwd) return;
    setPending("terminal");
    setNotice(null);
    try {
      await props.runtime.openTerminalAtPath(cwd);
      setNotice({ tone: "success", text: "已打开项目终端" });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "打开终端失败" });
    } finally {
      setPending(null);
    }
  }

  async function restore() {
    const session = props.execution.toolSession;
    const { projectId, workflowInstanceId, localPath } = props.execution;
    if (!session || !projectId || !workflowInstanceId || !localPath) return;
    setPending("restore");
    setNotice(null);
    try {
      await props.runtime.restoreToolSession({
        cwd: localPath,
        taskId: props.taskId,
        projectId,
        workflowInstanceId,
        sessionName: session.sessionName,
        sessionType: session.sessionType,
      });
      setNotice({ tone: "success", text: `已恢复会话 ${session.sessionName}` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "恢复会话失败" });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="task-local-actions">
      <div className="local-action-status">
        <span className={`local-action-dot${executionReady ? " is-ready" : ""}`} aria-hidden="true" />
        <span>
          <strong>{executionReady ? "本地环境已就绪" : "本地环境不可用"}</strong>
          <small>{props.runtime.isNative ? props.execution.localPath ?? "任务未配置本地目录" : "请在桌面客户端中执行"}</small>
        </span>
      </div>
      <div className="local-native-actions">
        <button aria-label="打开项目目录" disabled={!executionReady || pending !== null} onClick={() => void openFolder()} title="打开项目目录" type="button"><FolderOpen size={16} /></button>
        <button aria-label="打开项目终端" disabled={!executionReady || pending !== null} onClick={() => void openTerminal()} title="打开项目终端" type="button"><SquareTerminal size={16} /></button>
        {props.execution.toolSession ? (
          <button className="local-restore-action" disabled={!executionReady || pending !== null} onClick={() => void restore()} type="button">
            <RotateCcw aria-hidden="true" size={15} />
            恢复会话
          </button>
        ) : null}
      </div>
      {notice ? <p className="local-action-notice" data-tone={notice.tone} role="status">{notice.text}</p> : null}
    </div>
  );
}
