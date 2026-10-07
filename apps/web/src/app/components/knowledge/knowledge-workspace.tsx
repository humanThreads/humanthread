"use client";

import { BookOpen, Clock3, GitBranch, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState, StatusPill, WorkbenchButton } from "../workbench-ui";

export const KNOWLEDGE_WORKSPACE_TABS = ["query", "progress", "review", "architecture"] as const;
export type KnowledgeWorkspaceTab = (typeof KNOWLEDGE_WORKSPACE_TABS)[number];

export interface KnowledgeSearchItem {
  score: number;
  entryId: string | null;
  version: number | null;
  stableKey: string | null;
  title: string | null;
  entryType: string | null;
  content: string | null;
  headingPath: string[];
  tags: string[];
  chunkIndex: number;
  contentDigest: string | null;
}

export interface KnowledgeArchitectureViewItem {
  id: string;
  stableKey: string;
  title: string;
  latestVersion: number;
  updatedAt: string;
}

export interface KnowledgeProgressItem {
  id: string;
  status: string;
  stage: string;
  progress: number;
  processedChunks: number;
  totalChunks: number;
  failureMessage: string | null;
}

interface KnowledgeSearchApi {
  search(query: string): Promise<KnowledgeSearchItem[]>;
}

const TAB_LABELS: Record<KnowledgeWorkspaceTab, string> = {
  query: "查询",
  progress: "进度",
  review: "审核",
  architecture: "架构",
};

const TAB_ICONS = {
  query: Search,
  progress: Clock3,
  review: ShieldCheck,
  architecture: GitBranch,
} as const;

export function KnowledgeWorkspace({
  projectId,
  initialTab = "query",
  architectureViews,
  progress,
  reviewPanel,
  api = createBrowserSearchApi(projectId),
}: {
  projectId: string;
  initialTab?: KnowledgeWorkspaceTab;
  architectureViews: KnowledgeArchitectureViewItem[];
  progress: KnowledgeProgressItem[];
  reviewPanel: React.ReactNode;
  api?: KnowledgeSearchApi;
}) {
  const [activeTab, setActiveTab] = useState<KnowledgeWorkspaceTab>(initialTab);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeSearchItem[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function runSearch() {
    const value = query.trim();
    if (!value) return;
    setState("loading");
    setMessage(null);
    try {
      const items = await api.search(value);
      setResults(items);
      setState("idle");
    } catch (error) {
      setResults([]);
      setState("error");
      setMessage(error instanceof Error ? error.message : "知识查询失败");
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4">
      <div role="tablist" aria-label="知识库视图" className="flex flex-wrap gap-1 border-b border-[#d0d7de]">
        {KNOWLEDGE_WORKSPACE_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab];
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab)}
              className={active
                ? "inline-flex min-h-10 items-center gap-2 border-b-2 border-[#0969da] px-3 text-sm font-semibold text-[#0969da]"
                : "inline-flex min-h-10 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium text-[#57606a] hover:text-[#24292f]"}
            >
              <Icon aria-hidden="true" className="size-4" />{TAB_LABELS[tab]}
            </button>
          );
        })}
      </div>

      {activeTab === "query" ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
          <form className="grid content-start gap-3 rounded-lg border border-[#d0d7de] bg-white p-4" onSubmit={(event) => { event.preventDefault(); void runSearch(); }}>
            <label className="text-xs font-semibold text-[#24292f]" htmlFor="knowledge-query">知识查询</label>
            <div className="flex gap-2">
              <input
                id="knowledge-query"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="搜索规则、决策、接口或项目经验"
                className="min-h-9 min-w-0 flex-1 rounded-md border border-[#d0d7de] px-3 text-sm outline-none focus:border-[#0969da]"
              />
              <WorkbenchButton type="submit" size="small" variant="primary" disabled={state === "loading" || !query.trim()}>
                {state === "loading" ? "查询中" : "查询"}
              </WorkbenchButton>
            </div>
            <p className="text-xs leading-5 text-[#57606a]">默认仅查询当前项目；空间共享知识需要在项目策略中订阅。</p>
            {message ? <p role="alert" className="text-xs text-[#cf222e]">{message}</p> : null}
          </form>
          <div className="grid content-start gap-3">
            {results.length === 0 ? (
              <EmptyState title="尚未选择知识结果" description="输入问题或关键词后，这里会显示条目摘要、来源、关系和关联文档。" />
            ) : results.map((item) => (
              <article key={`${item.entryId ?? item.stableKey ?? item.contentDigest}:${item.chunkIndex}`} className="rounded-lg border border-[#d0d7de] bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="mr-auto text-sm font-semibold text-[#24292f]">{item.title ?? item.stableKey ?? "知识片段"}</h3>
                  {item.entryType ? <StatusPill tone="blue">{item.entryType}</StatusPill> : null}
                  <span className="text-xs text-[#57606a]">匹配度 {(item.score * 100).toFixed(0)}%</span>
                </div>
                {item.headingPath.length > 0 ? <p className="mt-1 text-xs text-[#57606a]">{item.headingPath.join(" / ")}</p> : null}
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#24292f]">{item.content ?? "无摘要"}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#d8dee4] pt-3">
                  {item.entryId && item.version !== null ? (
                    <Link href={`/projects/${encodeURIComponent(projectId)}/knowledge/entries/${encodeURIComponent(item.entryId)}?version=${item.version}`} className="text-xs font-semibold text-[#0969da] hover:underline">
                      打开知识条目 v{item.version}
                    </Link>
                  ) : null}
                  {item.tags.map((tag) => <span key={tag} className="rounded-full bg-[#f6f8fa] px-2 py-0.5 text-[11px] text-[#57606a]">{tag}</span>)}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "progress" ? (
        <section className="grid gap-3">
          {progress.length === 0 ? <EmptyState title="暂无入库批次" description="候选提交到平台后，这里会显示校验、分块、向量化和索引进度。" /> : progress.map((item) => (
            <article key={item.id} className="rounded-lg border border-[#d0d7de] bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="mr-auto text-sm text-[#24292f]">批次 {item.id.slice(0, 8)}</strong>
                <StatusPill tone={item.status === "searchable" ? "success" : item.status === "failed" ? "danger" : item.status === "review_required" ? "warning" : "blue"}>{item.stage}</StatusPill>
                <span className="text-xs text-[#57606a]">{item.progress}%</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#f6f8fa]"><div className="h-full bg-[#0969da]" style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} /></div>
              <p className="mt-2 text-xs text-[#57606a]">已处理 {item.processedChunks} / {item.totalChunks} 个分块{item.failureMessage ? ` · ${item.failureMessage}` : ""}</p>
            </article>
          ))}
        </section>
      ) : null}

      {activeTab === "review" ? reviewPanel : null}

      {activeTab === "architecture" ? (
        <section className="grid gap-3">
          {architectureViews.length === 0 ? <EmptyState title="暂无架构视图" description="知识 Worker 发布架构 Bundle 后，这里会显示可进入的整体关系和节点视图。" /> : architectureViews.map((view) => (
            <Link key={view.id} href={`/projects/${encodeURIComponent(projectId)}/knowledge/architecture/${encodeURIComponent(view.id)}`} className="flex items-center gap-3 rounded-lg border border-[#d0d7de] bg-white p-4 hover:border-[#0969da]">
              <BookOpen aria-hidden="true" className="size-4 text-[#0969da]" />
              <span className="min-w-0 flex-1"><strong className="block truncate text-sm text-[#24292f]">{view.title}</strong><span className="mt-1 block text-xs text-[#57606a]">{view.stableKey} · v{view.latestVersion}</span></span>
            </Link>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function createBrowserSearchApi(projectId: string): KnowledgeSearchApi {
  return {
    async search(query) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/knowledge/search?q=${encodeURIComponent(query)}`);
      const body = await response.json() as { ok?: boolean; result?: { items?: KnowledgeSearchItem[] } | { result?: { items?: KnowledgeSearchItem[] } }; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "知识查询失败");
      const result = "items" in (body.result ?? {}) ? body.result as { items?: KnowledgeSearchItem[] } : (body.result as { result?: { items?: KnowledgeSearchItem[] } })?.result;
      return result?.items ?? [];
    },
  };
}
