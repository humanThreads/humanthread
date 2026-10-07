"use client";

import { useState } from "react";

export function DocumentPermissionDialog({ open, targetId, targetType, spaceId, onClose }: { open: boolean; targetId: string; targetType: "document" | "directory"; spaceId: string; onClose(): void }) {
  const [query, setQuery] = useState("");
  const [permission, setPermission] = useState<"read" | "edit" | "manage">("read");
  const [members, setMembers] = useState<Array<{ id: string; name: string; email: string | null }>>([]);
  if (!open) return null;
  async function search(value: string) {
    setQuery(value);
    if (!value.trim()) return setMembers([]);
    const response = await fetch(`/api/companies/${encodeURIComponent(spaceId.replace(/^space:company:/u, ""))}/members/search?q=${encodeURIComponent(value)}`);
    const body = await response.json() as { members?: Array<{ id: string; name: string; email: string | null }> };
    setMembers(body.members ?? []);
  }
  async function grant(userId: string) {
    await fetch(`/api/${targetType === "document" ? "documents" : "document-directories"}/${encodeURIComponent(targetId)}/permissions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spaceId, userId, permission }) });
    onClose();
  }
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-black/30 p-4"><section role="dialog" aria-label="文件权限" className="w-full max-w-md rounded-md border border-[#d0d7de] bg-white p-5 shadow-xl"><div className="flex items-center justify-between"><h2 className="text-base font-semibold">设置访问权限</h2><button type="button" onClick={onClose} aria-label="关闭">关闭</button></div><input autoFocus value={query} onChange={(event) => void search(event.target.value)} placeholder="搜索姓名、邮箱或账号" className="mt-4 h-9 w-full rounded border border-[#d0d7de] px-3 text-sm" /><select value={permission} onChange={(event) => setPermission(event.target.value as typeof permission)} className="mt-3 h-9 w-full rounded border border-[#d0d7de] px-2 text-sm"><option value="read">只读</option><option value="edit">编辑</option><option value="manage">管理</option></select><div className="mt-3 grid gap-1">{members.map((member) => <button key={member.id} type="button" onClick={() => void grant(member.id)} className="flex items-center justify-between rounded px-2 py-2 text-left text-sm hover:bg-[#f6f8fa]"><span>{member.name}</span><span className="text-xs text-[#57606a]">{member.email ?? member.id}</span></button>)}</div></section></div>;
}
