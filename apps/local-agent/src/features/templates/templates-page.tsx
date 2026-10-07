import { workbenchQueryKey } from "@humanthread/workbench-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Grid2X2, List, LockKeyhole, Star } from "lucide-react";
import { useMemo, useState } from "react";

import { useDesktopSession } from "../../session/session-provider";
import { Pagination, usePaginatedItems } from "../../ui/pagination";
import { ReadModelError, ReadModelLoading } from "../read-first/read-model-state";
import {
  developmentTemplateCollectionResponseSchema,
  developmentTemplateMarketResponseSchema,
  developmentTemplateMutationResponseSchema,
  resolveDevelopmentTemplateSpaceId,
  type DevelopmentTemplateItem,
} from "./development-template-queries";

type TemplateTab = "market" | "custom";
type TemplateView = "card" | "list";
type MarketSort = "published" | "stars";

function commandId(): string {
  return `desktop:development-template:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export function TemplatesView(props: {
  marketTemplates: DevelopmentTemplateItem[];
  customTemplates: DevelopmentTemplateItem[];
  starredTemplateIds: string[];
  writeEnabled: boolean;
  busy: boolean;
  tab: TemplateTab;
  view: TemplateView;
  sort: MarketSort;
  onTabChange(tab: TemplateTab): void;
  onViewChange(view: TemplateView): void;
  onSortChange(sort: MarketSort): void;
  onStar(template: DevelopmentTemplateItem): void;
  onCopy(template: DevelopmentTemplateItem): void;
  onCreate(name: string): Promise<void>;
  onRename(template: DevelopmentTemplateItem): void;
  onVisibilityChange(template: DevelopmentTemplateItem): void;
  onDelete(template: DevelopmentTemplateItem): void;
}) {
  const [newName, setNewName] = useState("");
  const templates = props.tab === "market" ? props.marketTemplates : props.customTemplates;
  const pagination = usePaginatedItems(templates, {
    initialPageSize: props.view === "card" ? 12 : 20,
    resetKey: `${props.tab}:${props.view}:${props.sort}`,
  });

  return (
    <div className="templates-workspace loop-template-workspace">
      <header className="read-domain-toolbar">
        <div><strong>Loop 模板库</strong><span>与官网共用 Loop 市场和当前 Space 模版</span></div>
        <div className="segmented-control" aria-label="模板视图">
          <button aria-pressed={props.view === "card"} onClick={() => props.onViewChange("card")} type="button"><Grid2X2 aria-hidden="true" size={14} />卡片</button>
          <button aria-pressed={props.view === "list"} onClick={() => props.onViewChange("list")} type="button"><List aria-hidden="true" size={14} />列表</button>
        </div>
      </header>
      <nav aria-label="模板分类" className="template-tabs" role="tablist">
        <button aria-selected={props.tab === "market"} onClick={() => props.onTabChange("market")} role="tab" type="button">Loop 市场</button>
        <button aria-selected={props.tab === "custom"} onClick={() => props.onTabChange("custom")} role="tab" type="button">我的模版</button>
        {props.tab === "market" ? (
          <label className="template-sort"><span>排序</span><select aria-label="市场排序" onChange={(event) => props.onSortChange(event.target.value as MarketSort)} value={props.sort}><option value="published">发布时间</option><option value="stars">星星数量</option></select></label>
        ) : null}
      </nav>
      {props.tab === "custom" ? (
        <form className="template-create-row" onSubmit={(event) => { event.preventDefault(); void props.onCreate(newName).then(() => setNewName("")); }}>
          <input aria-label="新模板名称" disabled={!props.writeEnabled || props.busy} onChange={(event) => setNewName(event.target.value)} placeholder="新 Loop 模板名称" required value={newName} />
          <button className="primary-button" disabled={!props.writeEnabled || props.busy} type="submit">新建 Loop 模板</button>
        </form>
      ) : null}
      {templates.length === 0 ? (
        <div className="read-domain-empty"><ArrowRight aria-hidden="true" size={20} /><strong>{props.tab === "market" ? "当前没有公开的 Loop 模板" : "当前 Space 还没有我的 Loop 模版"}</strong><span>{props.tab === "market" ? "模板公开后会出现在 Loop 市场。" : "新建模板后可以配置 Loop 图、任务字段和发布策略。"}</span></div>
      ) : (
        <div className={props.view === "card" ? "template-grid" : "template-list-view"} data-columns={props.view === "card" ? "multi" : "list"} data-testid="template-card-grid">
          {pagination.items.map((template) => (
            <article className="template-card" key={template.id}>
              <header>
                <div>
                  <div className="template-title-row"><strong>{template.name}</strong>{template.isPublic ? <span className="template-public-state">已公开</span> : null}</div>
                  <small>{template.kind} · v{template.version} · ★ {template.starCount ?? 0}</small>
                </div>
              </header>
              <p>{template.description ?? "未填写说明"}</p>
              <div className="template-tags">{(template.industryTags ?? []).length ? template.industryTags?.map((tag) => <span key={tag}>{tag}</span>) : <span>未设置行业标签</span>}</div>
              <footer>
                {props.tab === "market" ? (
                  <>
                    <button className="secondary-button" disabled={!props.writeEnabled || props.busy} onClick={() => props.onStar(template)} type="button"><Star aria-hidden="true" size={14} />{props.starredTemplateIds.includes(template.id) ? "已星标" : "星标"} {template.starCount ?? 0}</button>
                    <button className="primary-button" disabled={!props.writeEnabled || props.busy} onClick={() => props.onCopy(template)} type="button"><ArrowRight aria-hidden="true" size={14} />复制到我的模版</button>
                  </>
                ) : (
                  <>
                    <button className="secondary-button" disabled={!props.writeEnabled || props.busy} onClick={() => props.onRename(template)} type="button">编辑</button>
                    <button className="secondary-button" disabled={!props.writeEnabled || props.busy} onClick={() => props.onVisibilityChange(template)} type="button"><LockKeyhole aria-hidden="true" size={14} />{template.isPublic ? "公开" : "私有"}</button>
                    <button className="secondary-button" disabled={!props.writeEnabled || props.busy} onClick={() => props.onDelete(template)} type="button">删除</button>
                  </>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
      <Pagination label={props.tab === "market" ? "Loop 市场分页" : "我的模版分页"} pagination={pagination} />
    </div>
  );
}

export function TemplatesPage() {
  const session = useDesktopSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TemplateTab>("market");
  const [view, setView] = useState<TemplateView>("card");
  const [sort, setSort] = useState<MarketSort>("published");
  const spaceId = resolveDevelopmentTemplateSpaceId({
    spaceKey: session.context?.spaceKey ?? "personal",
    userId: session.user?.id ?? "unknown",
  });
  const marketQuery = useQuery({
    enabled: Boolean(session.client && session.context),
    queryKey: session.context ? workbenchQueryKey(session.context, "development-template-market", { sort }) : ["templates", "market", "disabled"],
    queryFn: async () => {
      if (!session.client) throw new Error("桌面会话不可用");
      return session.client.request(`/api/development-templates/market?${new URLSearchParams({ sort }).toString()}`, developmentTemplateMarketResponseSchema);
    },
  });
  const customQuery = useQuery({
    enabled: Boolean(session.client && session.context),
    queryKey: session.context ? workbenchQueryKey(session.context, "development-templates", { spaceId }) : ["templates", "custom", "disabled"],
    queryFn: async () => {
      if (!session.client) throw new Error("桌面会话不可用");
      return session.client.request(`/api/development-templates?${new URLSearchParams({ spaceId }).toString()}`, developmentTemplateCollectionResponseSchema);
    },
  });
  const marketTemplates = useMemo(() => {
    const templates = marketQuery.data?.result.templates ?? [];
    return sort === "stars"
      ? [...templates].sort((left, right) => (right.starCount ?? 0) - (left.starCount ?? 0) || left.name.localeCompare(right.name, "zh-CN"))
      : templates;
  }, [marketQuery.data?.result.templates, sort]);
  const customTemplates = (customQuery.data?.result.templates ?? []).filter((template) => template.origin === "space" && template.status !== "deprecated");

  async function refresh() {
    await Promise.all([marketQuery.refetch(), customQuery.refetch()]);
  }

  const mutation = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => action(),
    onSuccess: refresh,
  });

  function request(path: string, init: RequestInit) {
    if (!session.client || !session.actionsEnabled) throw new Error("桌面会话当前不可写");
    return session.client.request(path, developmentTemplateMutationResponseSchema, init);
  }

  if (marketQuery.isPending || customQuery.isPending) return <ReadModelLoading label="正在加载 Loop 模板" />;
  if (marketQuery.isError) return <ReadModelError message={marketQuery.error.message} onRetry={() => void marketQuery.refetch()} />;
  if (customQuery.isError) return <ReadModelError message={customQuery.error.message} onRetry={() => void customQuery.refetch()} />;

  return (
    <TemplatesView
      busy={mutation.isPending}
      customTemplates={customTemplates}
      marketTemplates={marketTemplates}
      onCopy={(template) => mutation.mutate(() => request(`/api/development-templates/${encodeURIComponent(template.id)}/copy`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: commandId(), spaceId, name: `${template.name}（副本）` }) }))}
      onCreate={(name) => mutation.mutateAsync(() => request("/api/development-templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: commandId(), spaceId, name: name.trim() }) })).then(() => undefined)}
      onDelete={(template) => { if (window.confirm(`确认删除“${template.name}”？`)) mutation.mutate(() => request(`/api/development-templates/${encodeURIComponent(template.id)}/delete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: commandId(), expectedRevision: template.revision }) })); }}
      onRename={(template) => { const name = window.prompt("输入新的模板名称", template.name)?.trim(); if (name && name !== template.name) mutation.mutate(() => request(`/api/development-templates/${encodeURIComponent(template.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: commandId(), expectedRevision: template.revision, name }) })); }}
      onSortChange={setSort}
      onStar={(template) => mutation.mutate(() => request(`/api/development-templates/${encodeURIComponent(template.id)}/star`, { method: "POST" }))}
      onTabChange={setTab}
      onViewChange={setView}
      onVisibilityChange={(template) => { if (window.confirm(template.isPublic ? "确认从 Loop 市场移除？" : "确认公开到 Loop 市场？")) mutation.mutate(() => request(`/api/development-templates/${encodeURIComponent(template.id)}/market`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: commandId(), expectedRevision: template.revision, isPublic: !template.isPublic, industryTags: template.industryTags ?? [] }) })); }}
      sort={sort}
      starredTemplateIds={marketQuery.data.result.starredTemplateIds}
      tab={tab}
      view={view}
      writeEnabled={session.actionsEnabled}
    />
  );
}
