import { ArrowRight, Grid2X2, List, LockKeyhole, Star } from "lucide-react";
import { useMemo, useState } from "react";

import {
  developmentTemplateCollectionResponseSchema,
  developmentTemplateMarketResponseSchema,
  resolveDevelopmentTemplateSpaceId,
  type DevelopmentTemplateItem,
} from "../api/development-templates";
import { usePreviewReadModel, usePreviewSession } from "../session/preview-session";
import { Pagination, usePaginatedItems } from "../ui/pagination";
import { AsyncState, PageHeader, StatusPill, SurfaceHeader, SurfacePanel } from "../ui/primitives";

type TemplateTab = "market" | "custom";
type TemplateView = "card" | "list";
type MarketSort = "published" | "stars";

export function TemplatesPage() {
  const session = usePreviewSession();
  const [tab, setTab] = useState<TemplateTab>("market");
  const [view, setView] = useState<TemplateView>("card");
  const [sort, setSort] = useState<MarketSort>("published");
  const spaceId = resolveDevelopmentTemplateSpaceId({
    spaceKey: session.activeSpaceKey,
    userId: session.user?.id ?? "unknown",
  });
  const marketQuery = usePreviewReadModel({
    domain: "development-template-market",
    endpoint: "/api/development-templates/market",
    parameters: { sort },
    schema: developmentTemplateMarketResponseSchema,
  });
  const customQuery = usePreviewReadModel({
    domain: "development-templates",
    endpoint: "/api/development-templates",
    parameters: { spaceId },
    schema: developmentTemplateCollectionResponseSchema,
  });
  const customTemplates = (customQuery.data?.result.templates ?? []).filter(
    (template) => template.origin === "space" && template.status !== "deprecated",
  );
  const marketTemplates = useMemo(() => {
    const templates = marketQuery.data?.result.templates ?? [];
    return sort === "stars"
      ? [...templates].sort((left, right) => (right.starCount ?? 0) - (left.starCount ?? 0) || left.name.localeCompare(right.name, "zh-CN"))
      : templates;
  }, [marketQuery.data?.result.templates, sort]);
  const activeTemplates = tab === "market" ? marketTemplates : customTemplates;
  const pagination = usePaginatedItems(activeTemplates, {
    initialPageSize: view === "card" ? 12 : 20,
    resetKey: `${tab}:${view}:${sort}`,
  });
  const activeQuery = tab === "market" ? marketQuery : customQuery;

  return (
    <div className="page-stack">
      <PageHeader
        actions={<StatusPill tone="warning">只读预览</StatusPill>}
        description="对齐官网当前逻辑：Loop 市场与我的模版分开管理。"
        title="模板库"
      />
      <SurfacePanel>
        <SurfaceHeader
          actions={(
            <div className="segmented-control" aria-label="模板视图">
              <button aria-pressed={view === "card"} onClick={() => setView("card")} type="button"><Grid2X2 aria-hidden="true" size={14} />卡片</button>
              <button aria-pressed={view === "list"} onClick={() => setView("list")} type="button"><List aria-hidden="true" size={14} />列表</button>
            </div>
          )}
          title="模板库"
          description={tab === "market" ? "公开 Loop 模板，可星标或复制到当前 Space。" : "当前 Space 自己维护的 Loop 模板。"}
        />
        <nav aria-label="模板分类" className="template-tabs" role="tablist">
          <button aria-selected={tab === "market"} onClick={() => setTab("market")} role="tab" type="button">Loop 市场</button>
          <button aria-selected={tab === "custom"} onClick={() => setTab("custom")} role="tab" type="button">我的模版</button>
          {tab === "market" ? (
            <label className="compact-control template-sort">
              <span>排序</span>
              <select aria-label="市场排序" onChange={(event) => setSort(event.target.value as MarketSort)} value={sort}>
                <option value="published">发布时间</option>
                <option value="stars">星星数量</option>
              </select>
            </label>
          ) : (
            <button className="secondary-button" disabled title="设计预览只读" type="button">新建 Loop 模板</button>
          )}
        </nav>
        <AsyncState
          empty={activeQuery.isSuccess && activeTemplates.length === 0}
          emptyTitle={tab === "market" ? "当前没有公开的 Loop 模板" : "当前 Space 还没有我的 Loop 模版"}
          emptyDescription={tab === "market" ? "模板公开后会出现在 Loop 市场。" : "正式 Desktop 中可在这里新建和公开模板。"}
          error={activeQuery.error}
          label="正在加载 Loop 模板"
          onRetry={() => void activeQuery.refetch()}
          status={activeQuery.isPending ? "pending" : activeQuery.isError ? "error" : "success"}
        >
          <TemplateCollection templates={pagination.items} tab={tab} view={view} />
          <Pagination label={tab === "market" ? "Loop 市场分页" : "我的模版分页"} pagination={pagination} />
        </AsyncState>
      </SurfacePanel>
    </div>
  );
}

function TemplateCollection(props: {
  templates: DevelopmentTemplateItem[];
  tab: TemplateTab;
  view: TemplateView;
}) {
  return (
    <div className={props.view === "card" ? "template-grid" : "template-list-view"}>
      {props.templates.map((template) => (
        <article className="template-card" key={template.id}>
          <header>
            <div>
              <div className="template-title-row">
                <strong>{template.name}</strong>
                {template.isPublic ? <StatusPill tone="success">已公开</StatusPill> : null}
              </div>
              <small>{template.kind} · v{template.version} · ★ {template.starCount ?? 0}</small>
            </div>
          </header>
          <p>{template.description ?? "未填写说明"}</p>
          <div className="template-tags">
            {(template.industryTags ?? []).length > 0
              ? template.industryTags?.map((tag) => <span key={tag}>{tag}</span>)
              : <span>未设置行业标签</span>}
          </div>
          <footer>
            {props.tab === "market" ? (
              <>
                <button className="secondary-button" disabled title="设计预览只读" type="button"><Star aria-hidden="true" size={14} />星标 {template.starCount ?? 0}</button>
                <button className="primary-button" disabled title="设计预览只读" type="button"><ArrowRight aria-hidden="true" size={14} />复制到我的模版</button>
              </>
            ) : (
              <>
                <button className="secondary-button" disabled title="设计预览只读" type="button">编辑</button>
                <button className="secondary-button" disabled title="设计预览只读" type="button"><LockKeyhole aria-hidden="true" size={14} />{template.isPublic ? "公开" : "私有"}</button>
                <button className="secondary-button" disabled title="设计预览只读" type="button">删除</button>
              </>
            )}
          </footer>
        </article>
      ))}
    </div>
  );
}
