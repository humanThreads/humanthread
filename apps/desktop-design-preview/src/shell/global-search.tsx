import { desktopSearchResponseSchema } from "@humanthread/workbench-client";
import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { usePreviewReadModel } from "../session/preview-session";
import { AsyncState, StatusPill } from "../ui/primitives";

export function GlobalSearch(props: { onClose(): void }) {
  const [query, setQuery] = useState("");
  const searchQuery = usePreviewReadModel({
    domain: "global-search",
    endpoint: "/api/desktop/search",
    parameters: { q: query.trim() },
    enabled: query.trim().length > 0,
    schema: desktopSearchResponseSchema,
  });

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") props.onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [props]);

  const data = searchQuery.data?.data;
  const groups = data ? [
    ["任务", data.tasks],
    ["项目", data.projects],
    ["文档", data.documents],
    ["成员", data.members],
    ["Agents", data.agents],
  ] as const : [];

  return (
    <div className="overlay-backdrop" onMouseDown={props.onClose}>
      <section
        aria-label="全局搜索"
        aria-modal="true"
        className="search-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="search-dialog-header">
          <Search aria-hidden="true" size={18} />
          <input
            aria-label="搜索工作台"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索任务、项目、文档、成员和 Agents"
            value={query}
          />
          <button aria-label="关闭全局搜索" className="icon-button" onClick={props.onClose} type="button"><X aria-hidden="true" size={17} /></button>
        </header>
        <div className="search-results">
          {query.trim() ? (
            <AsyncState
              empty={Boolean(data && groups.every(([, items]) => items.length === 0))}
              emptyDescription="尝试更短或更具体的关键词。"
              emptyTitle="没有匹配结果"
              error={searchQuery.error}
              label="正在搜索"
              onRetry={() => void searchQuery.refetch()}
              status={searchQuery.isPending ? "pending" : searchQuery.isError ? "error" : "success"}
            >
              <div className="search-result-groups">
                {groups.map(([label, items]) => items.length ? (
                  <section key={label}>
                    <header><strong>{label}</strong><span>{items.length}</span></header>
                    {items.map((item) => (
                      <Link key={`${label}-${item.id}`} onClick={props.onClose} to={item.route}>
                        <span><strong>{item.title}</strong><small>{item.subtitle ?? "无补充信息"}</small></span>
                        {item.status ? <StatusPill tone="neutral">{item.status}</StatusPill> : null}
                      </Link>
                    ))}
                  </section>
                ) : null)}
              </div>
            </AsyncState>
          ) : (
            <div className="search-hint"><Search aria-hidden="true" size={20} /><strong>输入关键词开始搜索</strong><p>结果来自当前登录用户有权访问的官网数据。</p></div>
          )}
        </div>
      </section>
    </div>
  );
}
