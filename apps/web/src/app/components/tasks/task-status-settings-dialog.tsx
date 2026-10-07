"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Plus, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";

export interface TaskStatusDefinitionOption { id: string; key: string; name: string; category: string; color: string; sortOrder: number }

export function validateTaskStatusDraft(input: { name: string; key: string; category: string; color: string }) {
  if (!input.name.trim()) return "请输入状态名称";
  if (!input.key.trim()) return "请输入状态标识";
  if (!input.category) return "请选择业务状态类别";
  if (!/^#[0-9a-f]{6}$/iu.test(input.color)) return "请选择有效颜色";
  return null;
}

export function TaskStatusSettingsDialog({ open, spaceId, definitions, onOpenChange }: { open: boolean; spaceId: string; definitions: readonly TaskStatusDefinitionOption[]; onOpenChange(open: boolean): void }) {
  const [items, setItems] = useState(definitions);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [category, setCategory] = useState("");
  const [color, setColor] = useState("#0969da");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const invalid = validateTaskStatusDraft({ name, key, category, color });
    if (invalid) { setError(invalid); return; }
    setPending(true); setError(null);
    const id = `status:${spaceId}:${key}:${Date.now()}`;
    const response = await fetch("/api/task-status-definitions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, spaceId, key, name, category, color, sortOrder: items.length * 100 }) });
    const body = await response.json() as { ok: boolean; definition?: TaskStatusDefinitionOption; error?: string };
    if (response.ok && body.ok && body.definition) { setItems((current) => [...current, body.definition!]); setName(""); setKey(""); setCategory(""); } else setError(body.error ?? "状态创建失败");
    setPending(false);
  }
  async function remove(item: TaskStatusDefinitionOption) {
    setPending(true); setError(null);
    const response = await fetch("/api/task-status-definitions", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ spaceId, definitionId: item.id }) });
    const body = await response.json() as { ok: boolean; error?: string; code?: string };
    if (response.ok && body.ok) setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    else setError(body.code === "version_conflict" ? "请先迁移使用该状态的任务，再删除状态。" : body.error ?? "状态删除失败");
    setPending(false);
  }
  return <Dialog.Root open={open} onOpenChange={(next) => !pending && onOpenChange(next)}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[60] bg-[#1f2328]/45" /><Dialog.Content className="fixed inset-x-0 bottom-0 z-[60] max-h-[90vh] overflow-y-auto border border-[#d0d7de] bg-white outline-none sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[min(92vw,560px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg"><div className="flex items-start gap-3 border-b border-[#d0d7de] px-5 py-4"><div className="min-w-0 flex-1"><Dialog.Title className="font-semibold">状态设置</Dialog.Title><Dialog.Description className="mt-1 text-sm text-[#57606a]">类别决定业务流转，创建后不可随意变更。</Dialog.Description></div><button aria-label="关闭状态设置" onClick={() => onOpenChange(false)} className="grid h-8 w-8 place-items-center"><X size={17} /></button></div><div className="grid gap-4 p-5">{error ? <div role="alert" className="rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-sm text-[#cf222e]">{error}</div> : null}<div className="divide-y divide-[#d8dee4] rounded-md border border-[#d0d7de]">{items.map((item) => <div key={item.id} className="flex items-center gap-3 px-3 py-2"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: item.color }} /><span className="min-w-0 flex-1 text-sm font-medium">{item.name}</span><span className="text-xs text-[#57606a]">{item.category}</span><button aria-label={`删除${item.name}`} title={`删除${item.name}`} onClick={() => void remove(item)} className="grid h-8 w-8 place-items-center text-[#cf222e]"><Trash2 size={15} /></button></div>)}</div><form onSubmit={(event) => void submit(event)} className="grid gap-3 border-t border-[#d8dee4] pt-4"><div className="grid gap-3 sm:grid-cols-2"><input aria-label="状态名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="状态名称" className="h-10 rounded-md border border-[#8c959f] px-3 text-sm" /><input aria-label="状态标识" value={key} onChange={(e) => setKey(e.target.value)} placeholder="status_key" className="h-10 rounded-md border border-[#8c959f] px-3 text-sm" /></div><div className="grid gap-3 sm:grid-cols-[1fr_90px_auto]"><select aria-label="业务状态类别" value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 rounded-md border border-[#8c959f] bg-white px-3 text-sm"><option value="">选择类别</option><option value="backlog">Backlog</option><option value="todo">待处理</option><option value="in_progress">进行中</option><option value="in_review">待验收</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select><input aria-label="状态颜色" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-full rounded-md border border-[#8c959f] p-1" /><button disabled={pending} className="inline-flex h-10 items-center gap-1 rounded-md bg-[#1f883d] px-3 text-sm font-semibold text-white"><Plus size={15} />创建</button></div></form></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
