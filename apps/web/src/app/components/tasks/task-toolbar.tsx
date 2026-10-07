"use client";

import Link from "next/link";
import { CalendarDays, ChevronDown, Columns3, List, Search, SlidersHorizontal } from "lucide-react";

interface TaskToolbarProps {
  relation: string;
  view: string;
  queryString: string;
  relationCounts: Record<string, number>;
  projects: ReadonlyArray<{ id: string; name: string }>;
}

const RELATIONS = [
  ["all", "全部任务"], ["assigned", "分配给我"], ["created", "我创建的"],
  ["participating", "我参与的"], ["following", "我关注的"], ["overdue", "已逾期"], ["blocked", "已阻塞"], ["completed", "已完成"], ["archived", "已归档"],
] as const;

const STATUS_OPTIONS = [
  ["backlog", "待规划"], ["todo", "待处理"], ["in_progress", "进行中"],
  ["in_review", "待验收"], ["completed", "已完成"], ["cancelled", "已取消"],
] as const;

const UNASSIGNED_PROJECT = "__none__";

function queryHref(queryString: string, changes: Record<string, string | null>) {
  const query = new URLSearchParams(queryString);
  for (const [key, value] of Object.entries(changes)) {
    if (value) query.set(key, value); else query.delete(key);
  }
  query.delete("taskId");
  return `/tasks?${query.toString()}`;
}

function queryValues(query: URLSearchParams, name: string) {
  return [...new Set(
    query.getAll(name)
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function MultiChoiceFilter({ name, label, allLabel, options, selected }: {
  name: string;
  label: string;
  allLabel: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  selected: readonly string[];
}) {
  const summary = selected.length ? `${label}（${selected.length} 项）` : `${label}：${allLabel}`;
  return (
    <details className="relative shrink-0" data-filter={name}>
      <summary title={summary} className="flex h-9 cursor-pointer list-none items-center gap-1 rounded-md border border-[#d0d7de] bg-white px-2 text-sm text-[#57606a] hover:bg-[#f6f8fa] [&::-webkit-details-marker]:hidden">
        <span className="max-w-44 truncate">{summary}</span>
        <ChevronDown size={14} className="shrink-0 text-[#8c959f]" />
      </summary>
      <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-[#d0d7de] bg-white p-1.5 shadow-md">
        {options.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[#24292f] hover:bg-[#f6f8fa]">
            <input type="checkbox" name={name} value={option.value} defaultChecked={selected.includes(option.value)} className="h-4 w-4 shrink-0 accent-[#0969da]" />
            <span className="min-w-0 truncate">{option.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

export function TaskToolbar({ relation, view, queryString, relationCounts, projects }: TaskToolbarProps) {
  const currentQuery = new URLSearchParams(queryString);
  const preservedFields = [...currentQuery.entries()].filter(([key]) => !["search", "status", "project", "sort", "group", "taskId"].includes(key));
  const statusValues = queryValues(currentQuery, "status");
  const projectValues = queryValues(currentQuery, "project");
  const projectOptions = [
    ...projects.map((project) => ({ value: project.id, label: project.name })),
    { value: UNASSIGNED_PROJECT, label: "未归属项目" },
  ];

  return (
    <div className="grid shrink-0 border-b border-[#d0d7de] bg-white">
      <div className="flex min-h-12 items-center gap-1 overflow-x-auto px-3">
        {RELATIONS.map(([key, label]) => (
          <Link key={key} href={queryHref(queryString, { relation: key })} aria-current={relation === key ? "true" : undefined} className={relation === key ? "shrink-0 rounded-md bg-[#eaeef2] px-3 py-1.5 text-sm font-semibold text-[#24292f]" : "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-[#57606a] hover:bg-[#f6f8fa]"}>
            {label}{key !== "all" ? <span className="ml-1 text-xs text-[#8c959f]">{relationCounts[key] ?? 0}</span> : null}
          </Link>
        ))}
      </div>
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-t border-[#d8dee4] px-3 py-2">
        <form aria-label="筛选任务" action="/tasks" method="get" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {preservedFields.map(([name, value], index) => <input key={`${name}:${index}`} type="hidden" name={name} value={value} />)}
          <label className="relative min-w-[200px] flex-1 sm:max-w-sm">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8c959f]" />
            <input name="search" aria-label="搜索任务" defaultValue={currentQuery.get("search") ?? ""} placeholder="搜索任务" className="h-9 w-full rounded-md border border-[#d0d7de] pl-9 pr-3 text-sm outline-none focus:border-[#0969da]" />
          </label>
          <MultiChoiceFilter name="status" label="状态" allLabel="全部状态" selected={statusValues} options={STATUS_OPTIONS.map(([value, label]) => ({ value, label }))} />
          <MultiChoiceFilter name="project" label="项目" allLabel="全部项目" selected={projectValues} options={projectOptions} />
          <select name="sort" aria-label="排序方式" defaultValue={currentQuery.get("sort") ?? "updated_desc"} className="h-9 rounded-md border border-[#d0d7de] bg-white px-2 text-sm"><option value="updated_desc">最近更新</option><option value="due_asc">截止时间</option><option value="priority_desc">优先级</option><option value="created_desc">创建时间</option></select>
          {view === "board" ? <select name="group" aria-label="看板分组" defaultValue={currentQuery.get("group") ?? "status"} className="h-9 rounded-md border border-[#d0d7de] bg-white px-2 text-sm"><option value="status">按状态</option><option value="assignee">按负责人</option><option value="priority">按优先级</option><option value="project">按项目</option></select> : null}
          <button type="submit" aria-label="应用筛选" title="应用筛选" className="grid h-9 w-9 place-items-center rounded-md border border-[#d0d7de] bg-white text-[#57606a] hover:bg-[#f6f8fa]"><SlidersHorizontal size={15} /></button>
        </form>
        <div className="ml-auto inline-flex" aria-label="任务视图">
          <Link href={queryHref(queryString, { view: "list" })} aria-label="列表视图" title="列表视图" className="grid h-9 w-9 place-items-center rounded-l-md border border-[#d0d7de] text-[#24292f]"><List size={16} /></Link>
          <Link href={queryHref(queryString, { view: "board" })} aria-label="看板视图" title="看板视图" className="grid h-9 w-9 place-items-center border-y border-r border-[#d0d7de] text-[#57606a]"><Columns3 size={16} /></Link>
          <Link href={queryHref(queryString, { view: "calendar" })} aria-label="日历视图" title="日历视图" className="grid h-9 w-9 place-items-center rounded-r-md border-y border-r border-[#d0d7de] text-[#57606a]"><CalendarDays size={16} /></Link>
        </div>
      </div>
    </div>
  );
}
