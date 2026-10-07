import {
  desktopTaskCollectionResponseSchema,
  taskCommandResponseSchema,
  taskSavedViewsResponseSchema,
  type DesktopTaskCollectionResponse,
} from "@humanthread/workbench-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";

import { workbenchContextQueryPrefix } from "../../lib/query-client";
import { useDesktopSession } from "../../session/session-provider";
import { TaskBoard, type RunTaskCommand } from "./task-board";
import { TaskCalendar } from "./task-calendar";
import { TaskList } from "./task-list";
import { TaskPagination } from "./task-pagination";
import {
  buildTaskCollectionSearch,
  parseTaskCollectionQuery,
  taskCollectionQueryKey,
  type TaskCollectionQuery,
} from "./task-queries";
import {
  TaskToolbar,
  type TaskSavedViewOption,
} from "./task-toolbar";

type TaskCollection = DesktopTaskCollectionResponse["data"]["collection"];

const savedViewMutationResponseSchema = z.object({
  ok: z.literal(true),
  view: z.object({ id: z.string().min(1), name: z.string().min(1) }).passthrough(),
});

function savedViewId(): string {
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `task-view:desktop:${id}`;
}

function savedViewQuery(view: TaskSavedViewOption): TaskCollectionQuery {
  const search = new URLSearchParams();
  if (view.filters && typeof view.filters === "object") {
    for (const [key, value] of Object.entries(view.filters)) {
      if (typeof value === "string" || typeof value === "number") {
        search.set(key, String(value));
      } else if (Array.isArray(value)) {
        search.set(key, value.map(String).join(","));
      }
    }
  }
  return parseTaskCollectionQuery(search);
}

function currentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date());
}

function routeSearch(query: TaskCollectionQuery, spaceKey: string): URLSearchParams {
  const search = buildTaskCollectionSearch(query, spaceKey);
  search.delete("space");
  return search;
}

export function TaskWorkspace(props: {
  collection: TaskCollection;
  query: TaskCollectionQuery;
  savedViews: TaskSavedViewOption[];
  writeEnabled: boolean;
  onQueryChange: (changes: Partial<TaskCollectionQuery>) => void;
  onApplySavedView?: (view: TaskSavedViewOption) => void;
  onSaveView: (name: string) => Promise<void>;
  onPageChange(page: number): void;
  onPageSizeChange(pageSize: number): void;
  runTaskCommand: RunTaskCommand;
}) {
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);

  useEffect(() => {
    const availableIds = new Set(props.collection.listRows.map((task) => task.id));
    setSelectedTaskIds((current) => current.filter((id) => availableIds.has(id)));
  }, [props.collection.listRows]);

  return (
    <div className="task-workspace">
      <TaskToolbar
        {...(props.onApplySavedView ? { onApplySavedView: props.onApplySavedView } : {})}
        onChange={props.onQueryChange}
        onSaveView={props.onSaveView}
        query={props.query}
        relationCounts={props.collection.relationCounts}
        savedViews={props.savedViews}
        total={props.collection.total}
        writeEnabled={props.writeEnabled}
      />
      {selectedTaskIds.length > 0 ? (
        <div className="task-selection-bar">
          <strong>已选择 {selectedTaskIds.length} 项</strong>
          <button onClick={() => setSelectedTaskIds([])} type="button">清除选择</button>
        </div>
      ) : null}
      <div className="task-view-canvas">
        {props.query.view === "board" ? (
          <TaskBoard
            group={props.query.group}
            runTaskCommand={props.runTaskCommand}
            tasks={props.collection.listRows}
            writeEnabled={props.writeEnabled}
          />
        ) : props.query.view === "calendar" ? (
          <TaskCalendar calendar={props.collection.calendar} month={currentMonth()} />
        ) : (
          <TaskList
            onSelectionChange={setSelectedTaskIds}
            selectedTaskIds={selectedTaskIds}
            tasks={props.collection.listRows}
          />
        )}
      </div>
      {props.query.view === "list" ? (
        <TaskPagination
          hasNextPage={props.collection.hasNextPage ?? false}
          hasPreviousPage={props.collection.hasPreviousPage ?? props.query.page > 1}
          onPageChange={props.onPageChange}
          onPageSizeChange={props.onPageSizeChange}
          page={props.collection.page ?? props.query.page}
          pageSize={props.collection.pageSize ?? props.query.pageSize}
          total={props.collection.total}
        />
      ) : null}
    </div>
  );
}

export function TaskPage() {
  const session = useDesktopSession();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = useMemo(
    () => parseTaskCollectionQuery(searchParams),
    [searchParams],
  );
  const effectiveQuery = query.view === "list"
    ? query
    : { ...query, page: 1, pageSize: 100 };
  const taskQuery = useQuery({
    enabled: Boolean(session.client && session.context),
    queryKey: session.context
      ? taskCollectionQueryKey(session.context, effectiveQuery)
      : ["desktop", "tasks", "disabled"],
    queryFn: async () => {
      if (!session.client || !session.context) throw new Error("桌面会话不可用");
      const params = buildTaskCollectionSearch(effectiveQuery, session.context.spaceKey);
      return session.client.request(
        `/api/desktop/tasks?${params.toString()}`,
        desktopTaskCollectionResponseSchema,
      );
    },
  });
  const savedViewsQuery = useQuery({
    enabled: Boolean(session.client && session.context),
    queryKey: session.context
      ? [...workbenchContextQueryPrefix(session.context), "task-saved-views"]
      : ["desktop", "task-saved-views", "disabled"],
    queryFn: async () => {
      if (!session.client) throw new Error("桌面会话不可用");
      return session.client.request("/api/task-saved-views", taskSavedViewsResponseSchema);
    },
  });

  function updateQuery(changes: Partial<TaskCollectionQuery>) {
    if (!session.context) return;
    const next = {
      ...query,
      ...(changes.page === undefined && Object.keys(changes).some((key) => key !== "sort")
        ? { page: 1 }
        : {}),
      ...changes,
    };
    setSearchParams(routeSearch(next, session.context.spaceKey), { replace: true });
  }

  async function saveView(name: string) {
    if (!session.client || !session.context || !session.actionsEnabled) {
      throw new Error("桌面会话当前不可写");
    }
    await session.client.request("/api/task-saved-views", savedViewMutationResponseSchema, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: savedViewId(), name, ...query }),
    });
    await queryClient.invalidateQueries({
      queryKey: [...workbenchContextQueryPrefix(session.context), "task-saved-views"],
    });
  }

  const runTaskCommand: RunTaskCommand = async (taskId, command, payload) => {
    if (!session.client || !session.context || !session.actionsEnabled) {
      throw new Error("桌面会话当前不可写");
    }
    await session.client.request(
      `/api/tasks/${encodeURIComponent(taskId)}/commands/${encodeURIComponent(command)}`,
      taskCommandResponseSchema,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    await queryClient.invalidateQueries({
      queryKey: [...workbenchContextQueryPrefix(session.context), "tasks"],
    });
  };

  if (taskQuery.isPending) {
    return <div aria-label="正在加载任务" className="feature-loading-state" />;
  }
  if (taskQuery.isError) {
    return <p className="feature-error-state" role="alert">{taskQuery.error.message}</p>;
  }

  return (
    <TaskWorkspace
      collection={taskQuery.data.data.collection}
      onApplySavedView={(view) => {
        const next = savedViewQuery(view);
        setSearchParams(routeSearch(next, session.context!.spaceKey), { replace: true });
      }}
      onQueryChange={updateQuery}
      onPageChange={(page) => updateQuery({ page })}
      onPageSizeChange={(pageSize) => updateQuery({ pageSize, page: 1 })}
      onSaveView={saveView}
      query={query}
      runTaskCommand={runTaskCommand}
      savedViews={savedViewsQuery.data?.views ?? []}
      writeEnabled={session.status === "ready" && session.actionsEnabled}
    />
  );
}
