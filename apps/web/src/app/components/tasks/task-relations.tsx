"use client";

import { Download, FileText, Link2, Paperclip, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export function TaskRelations({ taskId, canEdit, childTasks, predecessors, successors, documents, attachments }: {
  taskId: string; canEdit: boolean;
  childTasks: Array<{ id: string; title: string; statusCategory: string | null }>;
  predecessors: Array<{ id: string; type: string; successorTask: { id: string; title: string; statusCategory: string | null } }>;
  successors: Array<{ id: string; type: string; predecessorTask: { id: string; title: string; statusCategory: string | null } }>;
  documents: Array<{ document: { id: string; title: string; path: string; version: number } }>;
  attachments: Array<{ id: string; originalName: string; mimeType: string; byteSize: number | bigint; createdAt: Date | string }>;
}) {
  const [items, setItems] = useState(attachments);
  const [linkedDocuments, setLinkedDocuments] = useState(documents);
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false);
  const [documentQuery, setDocumentQuery] = useState("");
  const [documentResults, setDocumentResults] = useState<Array<{ id: string; title: string; path: string; version: number }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!canEdit || !documentPickerOpen || !documentQuery.trim()) return;
    const timer = window.setTimeout(() => {
      void fetch(`/api/tasks/${encodeURIComponent(taskId)}/documents?q=${encodeURIComponent(documentQuery)}`).then((response) => response.json()).then((body: { documents?: typeof documentResults }) => setDocumentResults(body.documents ?? [])).catch(() => setDocumentResults([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [canEdit, documentPickerOpen, documentQuery, taskId]);
  async function addDocument(documentId: string) {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/documents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId }) });
    const body = await response.json() as { ok: boolean; link?: unknown; error?: string };
    if (response.ok && body.ok) { const document = documentResults.find((item) => item.id === documentId); if (document) setLinkedDocuments((current) => [...current, { document }]); setDocumentQuery(""); setDocumentResults([]); setDocumentPickerOpen(false); setMessage("文档已关联"); } else setMessage(body.error ?? "文档关联失败");
  }
  async function removeDocument(documentId: string) {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/documents?documentId=${encodeURIComponent(documentId)}`, { method: "DELETE" });
    const body = await response.json() as { ok: boolean; error?: string };
    if (response.ok && body.ok) { setLinkedDocuments((current) => current.filter((item) => item.document.id !== documentId)); setMessage("文档关联已解除"); } else setMessage(body.error ?? "解除文档关联失败");
  }
  async function upload(file: File) {
    const data = new FormData(); data.set("file", file); setMessage(null);
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/attachments`, { method: "POST", body: data });
    const body = await response.json() as { ok: boolean; attachment?: (typeof attachments)[number]; error?: string };
    if (response.ok && body.ok && body.attachment) { setItems((current) => [...current, body.attachment!]); setMessage("附件已上传"); }
    else setMessage(body.error ?? "附件上传失败");
  }
  async function remove(id: string) {
    const response = await fetch(`/api/task-attachments/${encodeURIComponent(id)}`, { method: "DELETE" });
    const body = await response.json() as { ok: boolean; error?: string };
    if (response.ok && body.ok) setItems((current) => current.filter((item) => item.id !== id)); else setMessage(body.error ?? "附件删除失败");
  }
  return <section className="grid gap-4 p-4" aria-label="任务关联">
    <div><h3 className="text-sm font-semibold">子任务</h3><div className="mt-2 grid gap-1">{childTasks.map((task) => <Link key={task.id} href={`/tasks/${task.id}`} className="text-sm text-[#0969da]">{task.title} · {task.statusCategory}</Link>)}{childTasks.length === 0 ? <p className="text-sm text-[#8c959f]">暂无子任务</p> : null}</div></div>
    <div><h3 className="text-sm font-semibold">依赖</h3><div className="mt-2 grid gap-1 text-sm text-[#57606a]">{predecessors.map((item) => <span key={item.id}><Link2 size={12} className="mr-1 inline" />后置：{item.successorTask.title}</span>)}{successors.map((item) => <span key={item.id}><Link2 size={12} className="mr-1 inline" />前置：{item.predecessorTask.title}</span>)}{!predecessors.length && !successors.length ? <span className="text-[#8c959f]">暂无依赖</span> : null}</div></div>
    <div><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">关联文档</h3>{canEdit ? <button type="button" aria-label="关联文档" title="关联文档" onClick={() => { setDocumentPickerOpen((value) => !value); setDocumentQuery(""); setDocumentResults([]); }} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d0d7de] px-2 text-xs font-semibold text-[#24292f]"><Link2 size={13} />关联文档</button> : null}</div>{documentPickerOpen ? <div className="mt-2 flex flex-wrap items-center gap-2"><input autoFocus aria-label="搜索可关联文档" value={documentQuery} onChange={(event) => setDocumentQuery(event.target.value)} placeholder="搜索文档" className="h-8 min-w-48 flex-1 rounded border border-[#d0d7de] px-2 text-xs" /><button type="button" aria-label="取消关联文档" onClick={() => { setDocumentPickerOpen(false); setDocumentQuery(""); setDocumentResults([]); }} className="h-8 px-2 text-xs text-[#57606a]">取消</button></div> : null}<div className="mt-2 grid gap-1">{linkedDocuments.map((item) => <div key={item.document.id} className="flex items-center gap-2"><Link href={`/documents/${item.document.id}?fromTask=${encodeURIComponent(taskId)}`} className="inline-flex min-w-0 flex-1 items-center gap-1 text-sm text-[#0969da]"><FileText size={13} />{item.document.title}</Link>{canEdit ? <button type="button" aria-label={`解除${item.document.title}关联`} title="解除文档关联" onClick={() => void removeDocument(item.document.id)} className="text-xs text-[#cf222e]">解除</button> : null}</div>)}{documentResults.map((item) => <button type="button" key={item.id} onClick={() => void addDocument(item.id)} className="flex items-center gap-2 border border-dashed border-[#d0d7de] px-2 py-1 text-left text-xs text-[#0969da]"><FileText size={13} />关联“{item.title}”</button>)}{linkedDocuments.length === 0 && documentResults.length === 0 ? <p className="text-sm text-[#8c959f]">暂无关联文档</p> : null}</div></div>
    <div><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">附件</h3>{canEdit ? <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-[#d0d7de] px-2 text-xs font-semibold"><Paperclip size={13} />上传<input aria-label="上传任务附件" type="file" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label> : null}</div><div className="mt-2 grid gap-1">{items.map((item) => <div key={item.id} className="flex min-h-9 items-center gap-2 border-b border-[#d8dee4] text-sm"><span className="min-w-0 flex-1 truncate">{item.originalName}</span><a aria-label={`下载${item.originalName}`} title={`下载${item.originalName}`} href={`/api/task-attachments/${item.id}`} className="grid h-8 w-8 place-items-center"><Download size={14} /></a>{canEdit ? <button aria-label={`删除${item.originalName}`} title={`删除${item.originalName}`} onClick={() => void remove(item.id)} className="grid h-8 w-8 place-items-center text-[#cf222e]"><Trash2 size={14} /></button> : null}</div>)}{items.length === 0 ? <p className="text-sm text-[#8c959f]">暂无附件</p> : null}</div></div>
    {message ? <div role={message.includes("失败") ? "alert" : "status"} className="text-xs text-[#57606a]">{message}</div> : null}
  </section>;
}
