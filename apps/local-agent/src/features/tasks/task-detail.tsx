import type { DesktopTaskDetail } from "@humanthread/workbench-client";
import { ArrowLeft, CalendarClock, FolderKanban, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";

import { TaskActivity } from "./task-activity";
import { DocumentPreview } from "../documents/document-preview";
import {
  TaskCollaboration,
  type PostTaskComment,
} from "./task-collaboration";
import {
  TaskCommandBar,
  type RunDetailTaskCommand,
} from "./task-command-bar";

const PRIORITY_LABELS = ["普通", "较高", "高", "紧急"] as const;

export function TaskDetail(props: {
  detail: DesktopTaskDetail;
  writeEnabled: boolean;
  onCommand: RunDetailTaskCommand;
  postComment: PostTaskComment;
  mutateCollaboration: import("./task-collaboration").MutateTaskCollaboration;
  localActions?: ReactNode;
}) {
  const [version, setVersion] = useState(props.detail.task.version);
  const { task, capabilities } = props.detail;

  useEffect(() => {
    setVersion(task.version);
  }, [task.version]);

  return (
    <article className="desktop-task-detail" aria-label="任务详情">
      <header className="desktop-task-detail-header">
        <Link className="task-back-link" to="/tasks" aria-label="返回任务列表">
          <ArrowLeft aria-hidden="true" size={16} />
        </Link>
        <div className="task-title-block">
          <div className="task-context-line">
            <FolderKanban aria-hidden="true" size={14} />
            <span>{task.project?.name ?? "个人任务"}</span>
            <span aria-hidden="true">/</span>
            <span>{task.status.name}</span>
          </div>
          <h1>{task.title}</h1>
          <div className="task-meta-line">
            <span><UserRound aria-hidden="true" size={13} />{task.assignee?.name ?? "未指派"}</span>
            <span><CalendarClock aria-hidden="true" size={13} />{task.dueAt ? new Date(task.dueAt).toLocaleString("zh-CN") : "未设置截止时间"}</span>
            <span>优先级 {PRIORITY_LABELS[task.priority] ?? task.priority}</span>
            <span>v{version}</span>
          </div>
        </div>
        <TaskCommandBar
          capabilities={capabilities}
          onCommand={props.onCommand}
          statusCategory={task.statusCategory}
          version={version}
          writeEnabled={props.writeEnabled}
        />
      </header>

      <div className="desktop-task-detail-scroll">
        <div className="desktop-task-detail-grid">
          <section className="task-detail-section task-content" aria-label="任务正文">
            <div className="task-section-heading">
              <h2>任务说明</h2>
              <span>{task.acceptanceMode === "human" ? "人工验收" : "标准验收"}</span>
            </div>
            {task.contentMarkdown.trim() ? (
              <DocumentPreview className="task-markdown-source" markdown={task.contentMarkdown} />
            ) : <p className="task-section-empty">尚未填写任务说明</p>}
          </section>

          {props.localActions ? (
            <section className="task-detail-section task-local-tools" aria-labelledby="task-local-tools-title">
              <div className="task-section-heading">
                <h2 id="task-local-tools-title">本地工具</h2>
                <span>当前设备</span>
              </div>
              {props.localActions}
            </section>
          ) : null}

          <TaskCollaboration
            availableLabels={props.detail.collaboration.availableLabels}
            availableMembers={props.detail.collaboration.availableMembers}
            canComment={capabilities.comment && props.writeEnabled}
            canEdit={capabilities.edit && props.writeEnabled}
            canManageMembers={capabilities.manageMembers && props.writeEnabled}
            comments={task.comments}
            labels={task.labels}
            members={task.members}
            mutateCollaboration={props.mutateCollaboration}
            onVersionChange={setVersion}
            postComment={props.postComment}
            reminders={task.reminders}
            taskId={task.id}
            version={version}
          />
          <TaskActivity activities={task.activities} />
        </div>
      </div>
    </article>
  );
}
