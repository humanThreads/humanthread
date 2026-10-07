import {
  desktopTaskDetailResponseSchema,
  taskMutationResponseSchema,
  type DesktopTaskDetail,
} from "@humanthread/workbench-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { reportDesktopNativeEvent } from "../../desktop/native-events";
import type { LocalAgentAccountSession } from "../../lib/binding";
import { workbenchContextQueryPrefix } from "../../lib/query-client";
import type { LocalRuntime } from "../../lib/runtime";
import { useDesktopSession } from "../../session/session-provider";
import { TaskLocalActions } from "../execution/task-local-actions";
import { TaskDetail } from "./task-detail";

export interface DesktopNativeContext {
  accountSession: LocalAgentAccountSession | null;
  runtime: LocalRuntime;
}

export function TaskDetailPage(props: {
  native: DesktopNativeContext;
  render: (input: {
    content: React.ReactNode;
  }) => React.ReactNode;
}) {
  const { taskId = "" } = useParams();
  const session = useDesktopSession();
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    enabled: Boolean(taskId && session.client && session.context),
    queryKey: session.context
      ? [...workbenchContextQueryPrefix(session.context), "tasks", "detail", taskId]
      : ["desktop", "tasks", "detail", "disabled"],
    queryFn: async () => {
      if (!session.client || !session.context) throw new Error("桌面会话不可用");
      const search = new URLSearchParams({ space: session.context.spaceKey });
      return session.client.request(
        `/api/desktop/tasks/${encodeURIComponent(taskId)}?${search.toString()}`,
        desktopTaskDetailResponseSchema,
      );
    },
  });

  async function mutate(path: string, init: RequestInit) {
    if (!session.client || !session.context || !session.actionsEnabled) {
      throw new Error("桌面会话当前不可写");
    }
    const response = await session.client.request(path, taskMutationResponseSchema, init);
    await queryClient.invalidateQueries({
      queryKey: [...workbenchContextQueryPrefix(session.context), "tasks"],
    });
    return response.result;
  }

  function reportEvent(event: Parameters<typeof reportDesktopNativeEvent>[0]["event"]) {
    if (!props.native.accountSession) {
      return Promise.reject(new Error("本地设备会话不可用"));
    }
    return reportDesktopNativeEvent({
      session: props.native.accountSession,
      credentials: session.runtimeCredentials,
      platform: props.native.runtime.platform,
      event,
    });
  }

  if (detailQuery.isPending) {
    return props.render({
      content: <div aria-label="正在加载任务详情" className="feature-loading-state" />,
    });
  }
  if (detailQuery.isError) {
    return props.render({
      content: <p className="feature-error-state" role="alert">{detailQuery.error.message}</p>,
    });
  }

  const detail: DesktopTaskDetail = detailQuery.data.data.detail;
  const canExecute = Boolean(
    detail.capabilities.nativeExecute
    && session.bootstrap?.capabilities.nativeExecution
    && session.actionsEnabled,
  );
  const localActions = (
    <TaskLocalActions
      canExecute={canExecute}
      execution={detail.execution}
      reportEvent={reportEvent}
      runtime={props.native.runtime}
      taskId={taskId}
    />
  );

  return props.render({
    content: (
      <TaskDetail
        detail={detail}
        localActions={localActions}
        mutateCollaboration={(resource, method, payload) => mutate(
          `/api/tasks/${encodeURIComponent(taskId)}/${resource}`,
          {
            method,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          },
        )}
        onCommand={(command, payload) => mutate(
          `/api/tasks/${encodeURIComponent(taskId)}/commands/${encodeURIComponent(command)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          },
        )}
        postComment={async (currentTaskId, payload) => mutate(
          `/api/tasks/${encodeURIComponent(currentTaskId)}/comments`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          },
        )}
        writeEnabled={session.status === "ready" && session.actionsEnabled}
      />
    ),
  });
}
