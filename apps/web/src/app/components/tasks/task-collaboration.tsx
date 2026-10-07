"use client";

import { AlertTriangle, BellPlus, MessageSquarePlus, UserPlus } from "lucide-react";
import { useState } from "react";
import { DocumentMarkdownRenderer } from "../document-markdown-renderer";
import { createTaskCommandId } from "../../../lib/tasks/task-command-id";

type CommentItem = { id: string; contentMarkdown: string; createdAt: Date | string; updatedAt: Date | string; author: { id: string; name: string; avatarUrl: string | null } };
type ActivityItem = { id: string; type: string; actorType: string; message: string; payload: unknown; createdAt: Date | string };

export function TaskCollaboration({ taskId, version, canComment, canEdit, canManageMembers, canChangeStatus, comments: initialComments, activities, members, availableMembers, blocker, assignedLabels, availableLabels, reminders, onVersionChange }: {
  taskId: string; version: number; canComment: boolean; canEdit: boolean; canManageMembers: boolean; canChangeStatus: boolean;
  comments: CommentItem[]; activities: ActivityItem[]; members: Array<{ userId: string; role: string; user?: { id: string; name: string; avatarUrl: string | null } }>;
  availableMembers: Array<{ id: string; name: string }>; blocker: { id: string; reason: string } | null;
  assignedLabels: Array<{ id: string; name: string; color: string }>; availableLabels: Array<{ id: string; name: string; color: string }>;
  reminders: Array<{ id: string; remindAt: Date | string; channel: string; status: string }>; onVersionChange(version: number): void;
}) {
  const [currentVersion, setCurrentVersion] = useState(version);
  const [comments, setComments] = useState(initialComments);
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  function advance(next: number) { setCurrentVersion(next); onVersionChange(next); }
  async function request(path: string, method: string, payload: Record<string, unknown>) {
    setPending(true); setMessage(null);
    try {
      const response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: createTaskCommandId(), expectedVersion: currentVersion, ...payload }) });
      const body = await response.json() as { ok: boolean; result?: { version: number }; error?: string };
      if (!response.ok || !body.ok || !body.result) throw new Error(body.error ?? "任务协作操作失败");
      advance(body.result.version); return body.result;
    } catch (error) { setMessage(error instanceof Error ? error.message : "任务协作操作失败"); return null; }
    finally { setPending(false); }
  }
  async function addComment() {
    const contentMarkdown = comment.trim(); if (!contentMarkdown) return;
    const result = await request(`/api/tasks/${encodeURIComponent(taskId)}/comments`, "POST", { contentMarkdown });
    if (result) { setComments((current) => [...current, { id: `local:${Date.now()}`, contentMarkdown, createdAt: new Date(), updatedAt: new Date(), author: { id: "current", name: "我", avatarUrl: null } }]); setComment(""); }
  }
  return <section className="grid gap-5 p-4" aria-label="任务协作">
    {blocker ? <div className="flex items-center gap-2 rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-sm text-[#cf222e]"><AlertTriangle size={14} />{blocker.reason}{canChangeStatus ? <button disabled={pending} onClick={() => void request(`/api/tasks/${encodeURIComponent(taskId)}/commands/resolve_blocker`, "POST", { blockerId: blocker.id })} className="ml-auto font-semibold">解除</button> : null}</div> : canChangeStatus ? <details><summary className="cursor-pointer text-sm font-semibold">添加阻塞</summary><form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); const reason = String(new FormData(event.currentTarget).get("reason") ?? ""); void request(`/api/tasks/${encodeURIComponent(taskId)}/commands/add_blocker`, "POST", { reason }); }}><input name="reason" aria-label="阻塞原因" className="h-9 min-w-0 flex-1 rounded-md border border-[#d0d7de] px-2 text-sm" /><button className="h-9 rounded-md bg-[#cf222e] px-3 text-sm font-semibold text-white">添加阻塞</button></form></details> : null}
    <div><h3 className="text-sm font-semibold">协作者</h3><div className="mt-2 flex flex-wrap gap-2">{members.map((member) => <span key={member.userId} className="rounded-md border border-[#d0d7de] px-2 py-1 text-xs">{member.user?.name ?? member.userId} · {member.role}</span>)}</div>{canManageMembers ? <div className="mt-2 flex gap-2"><select aria-label="添加协作者" defaultValue="" className="h-9 min-w-0 flex-1 rounded-md border border-[#d0d7de] bg-white px-2 text-sm" onChange={(event) => { if (event.target.value) void request(`/api/tasks/${encodeURIComponent(taskId)}/members`, "POST", { userId: event.target.value, role: "participant" }); }}><option value="">选择参与人</option>{availableMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><UserPlus size={16} className="mt-2.5 text-[#57606a]" /></div> : null}</div>
    <div><h3 className="text-sm font-semibold">标签</h3><div className="mt-2 flex flex-wrap gap-2">{assignedLabels.map((label) => <button disabled={!canEdit || pending} key={label.id} style={{ color: label.color, borderColor: label.color }} onClick={() => void request(`/api/tasks/${encodeURIComponent(taskId)}/labels`, "DELETE", { labelId: label.id })} className="rounded border px-2 py-1 text-xs">{label.name}</button>)}</div>{canEdit ? <select aria-label="添加任务标签" defaultValue="" className="mt-2 h-9 rounded-md border border-[#d0d7de] bg-white px-2 text-sm" onChange={(event) => { if (event.target.value) void request(`/api/tasks/${encodeURIComponent(taskId)}/labels`, "POST", { labelId: event.target.value }); }}><option value="">添加标签</option>{availableLabels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}</select> : null}</div>
    <div><h3 className="text-sm font-semibold">提醒</h3>{canComment ? <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); const remindAt = String(new FormData(event.currentTarget).get("remindAt") ?? ""); if (remindAt) void request(`/api/tasks/${encodeURIComponent(taskId)}/reminders`, "POST", { remindAt: new Date(remindAt).toISOString() }); }}><input name="remindAt" aria-label="提醒时间" type="datetime-local" className="h-9 min-w-0 flex-1 rounded-md border border-[#d0d7de] px-2 text-sm" /><button className="grid h-9 w-9 place-items-center rounded-md border border-[#d0d7de]" aria-label="创建提醒" title="创建提醒"><BellPlus size={15} /></button></form> : null}<div className="mt-2 text-xs text-[#57606a]">{reminders.map((item) => <div key={item.id}>{new Date(item.remindAt).toLocaleString("zh-CN")} · {item.status}</div>)}</div></div>
    <div><h3 className="text-sm font-semibold">评论</h3><div className="mt-2 grid gap-3">{comments.map((item) => <article key={item.id} className="border-l-2 border-[#d0d7de] pl-3"><div className="text-xs font-semibold text-[#57606a]">{item.author.name}</div><DocumentMarkdownRenderer markdown={item.contentMarkdown} /></article>)}</div>{canComment ? <div className="mt-3"><textarea aria-label="评论内容" value={comment} onChange={(event) => setComment(event.target.value)} className="min-h-24 w-full resize-y rounded-md border border-[#d0d7de] p-2 text-sm" /><button disabled={pending || !comment.trim()} onClick={() => void addComment()} className="mt-2 inline-flex h-9 items-center gap-1 rounded-md bg-[#1f883d] px-3 text-sm font-semibold text-white"><MessageSquarePlus size={14} />添加评论</button></div> : null}</div>
    <details><summary className="cursor-pointer text-sm font-semibold">活动记录 · {activities.length}</summary><div className="mt-2 grid gap-2">{activities.map((item) => <div key={item.id} className="border-l-2 border-[#d8dee4] pl-3 text-sm"><div>{item.message}</div><div className="text-xs text-[#8c959f]">{new Date(item.createdAt).toLocaleString("zh-CN")}</div></div>)}</div></details>
    {message ? <div role="alert" className="text-sm text-[#cf222e]">{message}</div> : null}
  </section>;
}
