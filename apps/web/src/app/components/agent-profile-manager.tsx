"use client";

import { Bot, Plus, Power } from "lucide-react";
import { useState } from "react";
import { StatusPill, WorkbenchButton } from "./workbench-ui";

export type AgentProfileManagerItem = {
  id: string;
  spaceId: string;
  name: string;
  provider: "codex" | "claude";
  status: "active" | "disabled";
  model: string | null;
};

export function AgentProfileManager({ initialProfiles, canManage, spaceId }: {
  initialProfiles: AgentProfileManagerItem[];
  canManage: boolean;
  spaceId: string | null;
}) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [creating, setCreating] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<"codex" | "claude">("codex");
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const manageable = canManage && Boolean(spaceId);

  async function createProfile() {
    if (!spaceId || !name.trim()) return;
    setPendingId("create");
    setError(null);
    try {
      const created = await requestJson("/api/agent-profiles", "POST", {
        commandId: commandId(),
        spaceId,
        name: name.trim(),
        provider,
        ...(model.trim() ? { model: model.trim() } : {}),
      });
      setProfiles((current) => [...current, created].sort((left, right) => left.name.localeCompare(right.name)));
      setName("");
      setModel("");
      setCreating(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Agent Profile 创建失败");
    } finally {
      setPendingId(null);
    }
  }

  async function setStatus(profile: AgentProfileManagerItem) {
    setPendingId(profile.id);
    setError(null);
    const status = profile.status === "active" ? "disabled" : "active";
    try {
      const updated = await requestJson(`/api/agent-profiles/${encodeURIComponent(profile.id)}`, "PATCH", {
        commandId: commandId(),
        status,
      });
      setProfiles((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Agent Profile 状态更新失败");
    } finally {
      setPendingId(null);
    }
  }

  return <section className="overflow-hidden rounded-md border border-[#d0d7de] bg-white">
    <header className="flex items-center justify-between gap-3 border-b border-[#d8dee4] px-4 py-3">
      <h2 className="text-sm font-semibold">Profiles</h2>
      {manageable ? <WorkbenchButton type="button" size="small" onClick={() => { setCreating((current) => !current); setError(null); }}><Plus aria-hidden="true" className="size-3.5" />新建 Profile</WorkbenchButton> : null}
    </header>
    {creating && manageable ? <form className="grid gap-3 border-b border-[#d8dee4] bg-[#f6f8fa] p-4 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void createProfile(); }}>
      <label className="grid gap-1 text-xs font-semibold text-[#57606a]">Profile 名称<input aria-label="Profile 名称" value={name} onChange={(event) => setName(event.currentTarget.value)} className="h-9 rounded-md border border-[#d0d7de] bg-white px-2 text-sm font-normal text-[#24292f]" /></label>
      <label className="grid gap-1 text-xs font-semibold text-[#57606a]">Provider<select aria-label="Provider" value={provider} onChange={(event) => setProvider(event.currentTarget.value === "claude" ? "claude" : "codex")} className="h-9 rounded-md border border-[#d0d7de] bg-white px-2 text-sm font-normal text-[#24292f]"><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
      <label className="grid gap-1 text-xs font-semibold text-[#57606a]">模型（可选）<input aria-label="模型（可选）" value={model} onChange={(event) => setModel(event.currentTarget.value)} className="h-9 rounded-md border border-[#d0d7de] bg-white px-2 text-sm font-normal text-[#24292f]" /></label>
      <div className="flex items-end gap-2 sm:col-span-3"><WorkbenchButton type="submit" size="small" disabled={pendingId === "create" || !name.trim()}>创建 Profile</WorkbenchButton><WorkbenchButton type="button" size="small" variant="secondary" onClick={() => setCreating(false)}>取消</WorkbenchButton></div>
    </form> : null}
    {error ? <p role="alert" className="border-b border-[#d8dee4] px-4 py-2 text-xs text-[#cf222e]">{error}</p> : null}
    <div className="divide-y divide-[#d8dee4]">
      {profiles.map((profile) => <div key={profile.id} className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3"><Bot className="size-4 shrink-0 text-[#59636e]" /><div className="min-w-0"><div className="break-words text-sm font-medium">{profile.name}</div><div className="mt-0.5 text-xs text-[#59636e]">{profile.provider}{profile.model ? ` · ${profile.model}` : ""}</div></div></div>
        <div className="flex shrink-0 items-center gap-2"><StatusPill tone={profile.status === "active" ? "success" : "default"}>{profile.status}</StatusPill>{manageable && profile.spaceId === spaceId ? <WorkbenchButton type="button" size="small" variant="secondary" disabled={pendingId === profile.id} onClick={() => void setStatus(profile)}><Power aria-hidden="true" className="size-3.5" />{profile.status === "active" ? `停用 ${profile.name}` : `启用 ${profile.name}`}</WorkbenchButton> : null}</div>
      </div>)}
      {profiles.length === 0 ? <p className="px-4 py-6 text-sm text-[#59636e]">当前 Space 没有 Agent Profile。</p> : null}
    </div>
  </section>;
}

async function requestJson(url: string, method: "POST" | "PATCH", body: Record<string, unknown>): Promise<AgentProfileManagerItem> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; result?: AgentProfileManagerItem; error?: string } | null;
  if (!response.ok || !payload?.ok || !payload.result) {
    throw Object.assign(new Error(payload?.error ?? "Agent Profile 请求失败"), { status: response.status });
  }
  return payload.result;
}

function commandId(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `agent-profile-${Date.now().toString(36)}`;
}
