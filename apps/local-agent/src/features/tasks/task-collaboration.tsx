import type { DesktopTaskDetail } from "@humanthread/workbench-client";
import { BellPlus, MessageSquarePlus, Tag, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";

type Comment = DesktopTaskDetail["task"]["comments"][number];

function commentCommandId(): string {
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `desktop:task:comment:${id}`;
}

export interface PostTaskCommentInput {
  commandId: string;
  expectedVersion: number;
  contentMarkdown: string;
}

export type PostTaskComment = (
  taskId: string,
  input: PostTaskCommentInput,
) => Promise<{ version: number }>;

export type MutateTaskCollaboration = (
  resource: "members" | "labels" | "reminders",
  method: "POST" | "DELETE",
  input: Record<string, unknown> & { commandId: string; expectedVersion: number },
) => Promise<{ version: number }>;

function collaborationCommandId(resource: string): string {
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `desktop:task:${resource}:${id}`;
}

export function TaskCollaboration(props: {
  taskId: string;
  version: number;
  canComment: boolean;
  canEdit: boolean;
  canManageMembers: boolean;
  comments: Comment[];
  members: DesktopTaskDetail["task"]["members"];
  labels: DesktopTaskDetail["task"]["labels"];
  reminders: DesktopTaskDetail["task"]["reminders"];
  availableMembers: DesktopTaskDetail["collaboration"]["availableMembers"];
  availableLabels: DesktopTaskDetail["collaboration"]["availableLabels"];
  postComment: PostTaskComment;
  mutateCollaboration: MutateTaskCollaboration;
  onVersionChange?: (version: number) => void;
}) {
  const [comments, setComments] = useState(props.comments);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(props.version);
  const [remindAt, setRemindAt] = useState("");

  useEffect(() => {
    setVersion(props.version);
  }, [props.version]);

  async function mutate(
    resource: "members" | "labels" | "reminders",
    method: "POST" | "DELETE",
    payload: Record<string, unknown>,
  ) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await props.mutateCollaboration(resource, method, {
        commandId: collaborationCommandId(resource),
        expectedVersion: version,
        ...payload,
      });
      setVersion(result.version);
      props.onVersionChange?.(result.version);
    } catch (mutateError) {
      setError(mutateError instanceof Error ? mutateError.message : "任务协作操作失败");
    } finally {
      setPending(false);
    }
  }

  async function submitComment() {
    const contentMarkdown = comment.trim();
    if (!contentMarkdown || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await props.postComment(props.taskId, {
        commandId: commentCommandId(),
        expectedVersion: version,
        contentMarkdown,
      });
      props.onVersionChange?.(result.version);
      setVersion(result.version);
      setComments((current) => [...current, {
        id: `local:${commentCommandId()}`,
        contentMarkdown,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: { id: "current", name: "我", avatarUrl: null },
      }]);
      setComment("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "评论发送失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="task-detail-section task-collaboration" aria-labelledby="task-comments-title">
      <div className="task-section-heading">
        <MessageSquarePlus aria-hidden="true" size={16} />
        <h2 id="task-comments-title">协作讨论</h2>
        <span>{comments.length}</span>
      </div>
      <div className="task-comment-list">
        {comments.map((item) => (
          <article className="task-comment" key={item.id}>
            <header>
              <strong>{item.author.name}</strong>
              <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("zh-CN")}</time>
            </header>
            <p>{item.contentMarkdown}</p>
          </article>
        ))}
        {!comments.length ? <p className="task-section-empty">还没有评论</p> : null}
      </div>
      <div className="task-collaboration-tools">
        <div>
          <div className="task-tool-heading"><UserPlus size={14} aria-hidden="true" /><strong>协作者</strong></div>
          <div className="task-tool-values">
            {props.members.map((member) => <span key={member.userId}>{member.user.name}</span>)}
            {!props.members.length ? <span>暂无协作者</span> : null}
          </div>
          {props.canManageMembers ? (
            <select
              aria-label="添加协作者"
              defaultValue=""
              disabled={pending}
              onChange={(event) => {
                if (event.target.value) void mutate("members", "POST", {
                  userId: event.target.value,
                  role: "participant",
                });
                event.currentTarget.value = "";
              }}
            >
              <option value="">选择参与人</option>
              {props.availableMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          ) : null}
        </div>
        <div>
          <div className="task-tool-heading"><Tag size={14} aria-hidden="true" /><strong>标签</strong></div>
          <div className="task-tool-values">
            {props.labels.map((label) => <span key={label.id} style={{ color: label.color }}>{label.name}</span>)}
            {!props.labels.length ? <span>暂无标签</span> : null}
          </div>
          {props.canEdit ? (
            <select
              aria-label="添加标签"
              defaultValue=""
              disabled={pending}
              onChange={(event) => {
                if (event.target.value) void mutate("labels", "POST", { labelId: event.target.value });
                event.currentTarget.value = "";
              }}
            >
              <option value="">选择标签</option>
              {props.availableLabels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
            </select>
          ) : null}
        </div>
        <div>
          <div className="task-tool-heading"><BellPlus size={14} aria-hidden="true" /><strong>提醒</strong></div>
          <div className="task-tool-values">
            {props.reminders.map((reminder) => <span key={reminder.id}>{new Date(reminder.remindAt).toLocaleString("zh-CN")}</span>)}
            {!props.reminders.length ? <span>暂无提醒</span> : null}
          </div>
          {props.canComment ? (
            <div className="task-reminder-control">
              <input aria-label="提醒时间" disabled={pending} onChange={(event) => setRemindAt(event.target.value)} type="datetime-local" value={remindAt} />
              <button
                aria-label="创建提醒"
                disabled={pending || !remindAt}
                onClick={() => {
                  if (!remindAt) return;
                  void mutate("reminders", "POST", { remindAt: new Date(remindAt).toISOString() });
                  setRemindAt("");
                }}
                title="创建提醒"
                type="button"
              ><BellPlus size={14} /></button>
            </div>
          ) : null}
        </div>
      </div>
      {props.canComment ? (
        <div className="task-comment-composer">
          <label htmlFor="task-comment">评论</label>
          <textarea
            disabled={pending}
            id="task-comment"
            onChange={(event) => setComment(event.target.value)}
            placeholder="记录进展、问题或需要确认的决定"
            value={comment}
          />
          <button
            disabled={pending || !comment.trim()}
            onClick={() => void submitComment()}
            type="button"
          >
            发送评论
          </button>
        </div>
      ) : null}
      {error ? <p className="task-inline-error" role="alert">{error}</p> : null}
    </section>
  );
}
