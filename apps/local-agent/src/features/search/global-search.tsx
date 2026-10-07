import { useEffect, useState } from "react";
import type { DesktopSearchResponse } from "@humanthread/workbench-client";
import { Search, X } from "lucide-react";
import { Link } from "react-router-dom";

type SearchData = DesktopSearchResponse["data"];
type SearchItem = SearchData["tasks"][number];

const EMPTY_RESULTS: SearchData = {
  query: "",
  tasks: [],
  projects: [],
  documents: [],
  members: [],
  agents: [],
};

export function GlobalSearch(props: {
  contextKey: string;
  onClose: () => void;
  search: (query: string) => Promise<SearchData>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchData>(EMPTY_RESULTS);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQuery("");
    setResults(EMPTY_RESULTS);
    setError(null);
  }, [props.contextKey]);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      setResults(EMPTY_RESULTS);
      setPending(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPending(true);
      setError(null);
      void props.search(normalized).then((next) => {
        if (!cancelled) {
          setResults(next);
          setError(null);
        }
      }).catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "搜索失败");
      }).finally(() => {
        if (!cancelled) setPending(false);
      });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [props.search, query]);

  const groups: Array<[string, SearchItem[]]> = [
    ["任务", results.tasks],
    ["项目", results.projects],
    ["文档", results.documents],
    ["成员", results.members],
    ["Agents", results.agents],
  ];
  const resultCount = groups.reduce((count, [, items]) => count + items.length, 0);

  return (
    <div className="desktop-overlay" role="presentation">
      <section className="global-search" aria-label="全局搜索" aria-modal="true" role="dialog">
        <header>
          <Search aria-hidden="true" size={19} />
          <input
            aria-label="搜索任务、项目和文档"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索任务、项目、文档、成员或 Agent"
            role="searchbox"
            value={query}
          />
          <button aria-label="关闭全局搜索" onClick={props.onClose} type="button"><X size={18} /></button>
        </header>
        <div className="global-search-results">
          {pending ? <p>正在搜索</p> : null}
          {error ? <p role="alert">{error}</p> : null}
          {!pending && query.trim() && resultCount === 0 ? <p>没有匹配结果。</p> : null}
          {groups.map(([label, items]) => items.length > 0 ? (
            <section key={label} aria-label={label}>
              <h2>{label}</h2>
              {items.map((item) => (
                <Link key={`${label}:${item.id}`} onClick={props.onClose} to={item.route}>
                  <span><strong>{item.title}</strong><small>{item.subtitle}</small></span>
                  {item.status ? <em>{item.status}</em> : null}
                </Link>
              ))}
            </section>
          ) : null)}
        </div>
      </section>
    </div>
  );
}
