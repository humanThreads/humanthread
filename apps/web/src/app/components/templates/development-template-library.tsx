"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { StatusPill, WorkbenchButton } from "../workbench-ui";

export interface DevelopmentTemplateListItem {
  id: string;
  name: string;
  kind: string;
  version: number;
  status: "draft" | "published" | "deprecated";
  origin: "platform" | "space";
  spaceId: string | null;
  description: string | null;
  revision: number;
  createdByUserId?: string | null;
  isPublic?: boolean | undefined;
  industryTags?: readonly string[] | undefined;
  starCount?: number | undefined;
}

export const LOOP_MARKET_INDUSTRIES = [
  "农林牧渔", "石油石化", "煤炭", "金属及金属矿", "建材及非金属", "基础化工", "医药生物", "食品饮料", "纺织服装", "轻工制造", "汽车", "家用电器", "机械设备", "航空航天与国防", "电力设备", "信息技术", "建筑业", "房地产", "金融业", "交通运输、仓储及物流业", "环保", "公用事业", "文化传媒", "社会服务", "商业服务", "商贸零售", "公共管理、社会保障和社会组织", "综合",
] as const;

type Tab = "market" | "custom";
type View = "list" | "card";
type VisibilityChange = { template: DevelopmentTemplateListItem; isPublic: boolean };

export function DevelopmentTemplateLibrary({
  spaceId,
  spaceKey,
  templates,
  marketTemplates = [],
  starredTemplateIds = [],
  currentUserId,
  spaceRole,
}: {
  spaceId: string;
  spaceKey?: string;
  templates: readonly DevelopmentTemplateListItem[];
  marketTemplates?: readonly DevelopmentTemplateListItem[];
  starredTemplateIds?: readonly string[];
  currentUserId?: string;
  spaceRole?: "owner" | "admin" | "member" | "viewer" | null | undefined;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("market");
  const [view, setView] = useState<View>("card");
  const [sort, setSort] = useState<"published" | "stars">("published");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [visibilityChange, setVisibilityChange] = useState<VisibilityChange | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [starred, setStarred] = useState(() => new Set(starredTemplateIds));
  const custom = templates.filter((template) => template.origin === "space" && template.status !== "deprecated");
  const market = useMemo(() => sort === "stars"
    ? [...marketTemplates].sort((left, right) => (right.starCount ?? 0) - (left.starCount ?? 0) || left.name.localeCompare(right.name, "zh-CN"))
    : marketTemplates, [marketTemplates, sort]);

  const detailHref = (templateId: string) => `/templates/development/${encodeURIComponent(templateId)}${spaceKey ? `?space=${encodeURIComponent(spaceKey)}` : ""}`;
  const canManage = (template: DevelopmentTemplateListItem) => template.createdByUserId === currentUserId || spaceRole === "owner" || spaceRole === "admin";

  async function request(path: string, method: string, body: unknown) {
    const response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as { ok?: boolean; result?: Record<string, unknown>; error?: string };
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Loop 模板操作失败");
    return result.result ?? {};
  }

  async function copy(template: DevelopmentTemplateListItem) {
    if (pendingId) return;
    setPendingId(template.id); setMessage(null);
    try {
      const result = await request(`/api/development-templates/${encodeURIComponent(template.id)}/copy`, "POST", { commandId: commandId(), spaceId, name: `${template.name}（副本）` });
      const templateId = typeof result.templateId === "string" ? result.templateId : typeof result.id === "string" ? result.id : null;
      if (!templateId) throw new Error("复制 Loop 模板失败");
      router.push(detailHref(templateId));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "复制 Loop 模板失败"); } finally { setPendingId(null); }
  }

  async function create() {
    if (pendingId) return;
    setPendingId("create"); setMessage(null);
    try {
      const result = await request("/api/development-templates", "POST", { commandId: commandId(), spaceId, name: "未命名 Loop 模板" });
      const templateId = typeof result.templateId === "string" ? result.templateId : typeof result.id === "string" ? result.id : null;
      if (!templateId) throw new Error("新建 Loop 模板失败");
      router.push(detailHref(templateId));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "新建 Loop 模板失败"); } finally { setPendingId(null); }
  }

  async function remove(template: DevelopmentTemplateListItem) {
    if (pendingId) return;
    setPendingId(template.id); setMessage(null);
    try { await request(`/api/development-templates/${encodeURIComponent(template.id)}/delete`, "POST", { commandId: commandId(), expectedRevision: template.revision }); router.refresh(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "删除 Loop 模板失败"); } finally { setPendingId(null); }
  }

  async function updatePublic(template: DevelopmentTemplateListItem, isPublic: boolean) {
    if (pendingId) return;
    setPendingId(template.id); setMessage(null);
    try {
      await request(`/api/development-templates/${encodeURIComponent(template.id)}/market`, "PATCH", {
        commandId: commandId(), expectedRevision: template.revision, isPublic, industryTags: template.industryTags ?? [],
      });
      router.refresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "更新公开状态失败"); } finally { setPendingId(null); setVisibilityChange(null); }
  }

  async function toggleStar(template: DevelopmentTemplateListItem) {
    if (pendingId) return;
    setPendingId(template.id); setMessage(null);
    try {
      const result = await request(`/api/development-templates/${encodeURIComponent(template.id)}/star`, "POST", {});
      setStarred((current) => {
        const next = new Set(current);
        if (result.starred === true) next.add(template.id); else next.delete(template.id);
        return next;
      });
      router.refresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "星标操作失败"); } finally { setPendingId(null); }
  }

  return <div className="grid gap-5">
    {message ? <p role="alert" className="text-sm text-[#cf222e]">{message}</p> : null}
    <section className="border-y border-[#d0d7de] bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d0d7de] px-4 py-3">
        <div role="tablist" aria-label="Loop 模板分类" className="flex items-center gap-1">
          <button role="tab" aria-selected={tab === "market"} type="button" onClick={() => setTab("market")} className={tab === "market" ? tabClass.active : tabClass.idle}>Loop 市场</button>
          <button role="tab" aria-selected={tab === "custom"} type="button" onClick={() => setTab("custom")} className={tab === "custom" ? tabClass.active : tabClass.idle}>我的模版</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tab === "market" ? <label className="text-xs text-[#57606a]">排序<select aria-label="市场排序" value={sort} onChange={(event) => setSort(event.currentTarget.value as "published" | "stars")} className="ml-1 rounded border border-[#d0d7de] bg-white px-2 py-1"><option value="published">发布时间</option><option value="stars">星星数量</option></select></label> : <WorkbenchButton type="button" variant="primary" disabled={Boolean(pendingId)} onClick={create}>{pendingId === "create" ? "新建中" : "新建 Loop 模板"}</WorkbenchButton>}
          <div className="inline-flex overflow-hidden rounded border border-[#d0d7de]" aria-label="展示方式"><button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className="px-2 py-1 text-xs">列表</button><button type="button" aria-pressed={view === "card"} onClick={() => setView("card")} className="border-l border-[#d0d7de] px-2 py-1 text-xs">卡片</button></div>
        </div>
      </header>
      {tab === "market" ? <TemplateCollection view={view} empty="当前没有公开的 Loop 模板。" templates={market} renderActions={(template) => <div className="flex flex-wrap gap-2"><WorkbenchButton type="button" size="small" disabled={Boolean(pendingId)} onClick={() => toggleStar(template)}>{starred.has(template.id) ? "★ 已星标" : "☆ 星标"} {template.starCount ?? 0}</WorkbenchButton><WorkbenchButton type="button" size="small" variant="primary" disabled={Boolean(pendingId)} onClick={() => copy(template)}>复制到我的模版</WorkbenchButton></div>} /> : <TemplateCollection view={view} empty="当前 Space 还没有我的 Loop 模版。" templates={custom} renderActions={(template) => canManage(template) ? <div className="flex flex-wrap items-center gap-3"><Link href={detailHref(template.id)} className="inline-flex min-h-7 items-center rounded-md border border-[#d0d7de] bg-white px-2.5 text-xs font-semibold text-[#24292f]">编辑</Link><button type="button" role="switch" aria-label={`${template.name}公开状态`} aria-checked={template.isPublic === true} disabled={Boolean(pendingId)} onClick={() => setVisibilityChange({ template, isPublic: !template.isPublic })} className={`inline-flex min-h-7 items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${template.isPublic ? "border-[#1f883d] bg-[#dafbe1] text-[#116329] hover:bg-[#c6f6d5]" : "border-[#d0d7de] bg-[#f6f8fa] text-[#57606a] hover:bg-[#f3f4f6]"}`}><span aria-hidden="true" className={`h-2 w-2 rounded-full ${template.isPublic ? "bg-[#1f883d]" : "bg-[#8c959f]"}`} />{template.isPublic ? "公开" : "私有"}</button><WorkbenchButton type="button" size="small" variant="danger" disabled={Boolean(pendingId)} onClick={() => remove(template)}>删除</WorkbenchButton></div> : <Link href={detailHref(template.id)} className="inline-flex min-h-7 items-center rounded-md border border-[#d0d7de] bg-white px-2.5 text-xs font-semibold text-[#24292f]">查看</Link>} />}
    </section>
    {visibilityChange ? <VisibilityConfirmDialog change={visibilityChange} pending={pendingId === visibilityChange.template.id} onCancel={() => setVisibilityChange(null)} onConfirm={() => void updatePublic(visibilityChange.template, visibilityChange.isPublic)} /> : null}
  </div>;
}

function VisibilityConfirmDialog({ change, pending, onCancel, onConfirm }: { change: VisibilityChange; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  const title = change.isPublic ? "确认公开 Loop 模板" : "确认设为私有 Loop 模板";
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#1f2328]/45 p-4" role="presentation">
    <section className="w-full max-w-md rounded-lg border border-[#d0d7de] bg-white p-5 shadow-xl motion-safe:animate-[loop-dialog-in_180ms_ease-out]" role="dialog" aria-modal="true" aria-label={title}>
      <h2 className="text-base font-semibold text-[#24292f]">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[#57606a]">{change.isPublic ? `“${change.template.name}”将展示在 Loop 市场，其他用户可查看并复制该模版。` : `“${change.template.name}”将从 Loop 市场移除，其他用户将不能再查看或复制该模版。`}</p>
      <div className="mt-5 flex justify-end gap-2"><WorkbenchButton type="button" disabled={pending} onClick={onCancel}>取消</WorkbenchButton><WorkbenchButton type="button" variant={change.isPublic ? "primary" : "danger"} disabled={pending} onClick={onConfirm}>{pending ? "处理中" : change.isPublic ? "确认公开" : "确认设为私有"}</WorkbenchButton></div>
    </section>
  </div>;
}

function TemplateCollection({ templates, empty, view, renderActions }: { templates: readonly DevelopmentTemplateListItem[]; empty: string; view: View; renderActions: (template: DevelopmentTemplateListItem) => React.ReactNode }) {
  if (templates.length === 0) return <p className="px-4 py-8 text-sm text-[#57606a]">{empty}</p>;
  return <div className={view === "card" ? "grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3" : "divide-y divide-[#d0d7de]"}>{templates.map((template) => <article key={template.id} data-testid="development-template-row" className={view === "card" ? "grid gap-3 rounded border border-[#d0d7de] p-4" : "grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-[#24292f]">{template.name}</h3>{template.isPublic ? <StatusPill tone="success">已公开</StatusPill> : null}</div><p className="mt-1 text-xs leading-5 text-[#57606a]">{template.description ?? "未填写说明"}</p><div className="mt-2 flex flex-wrap gap-1">{(template.industryTags ?? []).map((tag) => <span key={tag} className="rounded-full bg-[#ddf4ff] px-2 py-0.5 text-[11px] text-[#0969da]">{tag}</span>)}</div><p className="mt-2 text-[11px] text-[#6e7781]">{template.kind} · ★ {template.starCount ?? 0}</p></div>{renderActions(template)}</article>)}</div>;
}

const tabClass = { active: "rounded-md bg-[#0969da] px-3 py-1.5 text-sm font-semibold text-white", idle: "rounded-md px-3 py-1.5 text-sm font-semibold text-[#57606a] hover:bg-[#f6f8fa]" };
function commandId(): string { return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `development-template-${Date.now().toString(36)}`; }
