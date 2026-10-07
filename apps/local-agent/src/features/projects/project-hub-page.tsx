import {
  desktopProjectDetailResponseSchema,
  desktopWorkspaceConfigurationMutationResponseSchema,
  type DesktopProjectDetail,
  type WorkspaceConfigurationRevokeRequest,
  type WorkspaceConfigurationUpsertRequest,
} from "@humanthread/workbench-client";
import { useQuery } from "@tanstack/react-query";
import { Bot, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { createNativeExecutionConfigStore } from "../../desktop/execution-config-store";
import type { LocalRuntime } from "../../lib/runtime";
import { useDesktopSession } from "../../session/session-provider";
import { ProjectOverview } from "./project-overview";
import { projectDetailQueryKey } from "./project-queries";
import { ProjectRisks } from "./project-risks";
import { ProjectRoadmap } from "./project-roadmap";
import { ProjectWorkspaceSettings } from "./project-workspace-settings";

function compactDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" })
    .format(new Date(value));
}

function ProjectTasks(props: { detail: DesktopProjectDetail }) {
  return (
    <section className="project-hub-section project-delivery-list" aria-labelledby="project-tasks-title">
      <header>
        <h2 id="project-tasks-title">近期任务</h2>
        <Link to={`/tasks?project=${encodeURIComponent(props.detail.project.id)}`}>查看全部 {props.detail.taskSummary.total}</Link>
      </header>
      {props.detail.tasks.length ? props.detail.tasks.map((task) => (
        <Link aria-label={task.title} key={task.id} to={task.route}>
          <span className="project-row-state">{task.status}</span>
          <strong>{task.title}</strong>
          <span>{task.assigneeName ?? "未指派"}</span>
          <time dateTime={task.updatedAt}>{compactDate(task.updatedAt)}</time>
        </Link>
      )) : <p className="project-section-empty">当前项目没有任务</p>}
    </section>
  );
}

function ProjectDocuments(props: { detail: DesktopProjectDetail }) {
  return (
    <section className="project-hub-section project-resource-list" aria-labelledby="project-documents-title">
      <header><h2 id="project-documents-title">项目文档</h2><span>{props.detail.resources.documents} 篇</span></header>
      {props.detail.documents.length ? props.detail.documents.map((document) => (
        <Link aria-label={document.title} key={document.id} to={document.route}>
          <FileText aria-hidden="true" size={16} />
          <span><strong>{document.title}</strong><small>{document.path} · v{document.version}</small></span>
          <time dateTime={document.updatedAt}>{compactDate(document.updatedAt)}</time>
        </Link>
      )) : <p className="project-section-empty">当前项目没有文档</p>}
    </section>
  );
}

function ProjectAgents(props: { agents: DesktopProjectDetail["agents"] }) {
  return (
    <section className="project-hub-section project-resource-list" aria-labelledby="project-agents-title">
      <header><h2 id="project-agents-title">Agent 上下文</h2><span>{props.agents.length} 个活动流</span></header>
      {props.agents.length ? props.agents.map((agent) => (
        <Link aria-label={agent.title} key={agent.id} to={agent.route}>
          <Bot aria-hidden="true" size={16} />
          <span><strong>{agent.title}</strong><small>{agent.currentStepKey}</small></span>
          <span className="project-row-state">{agent.status}</span>
        </Link>
      )) : <p className="project-section-empty">当前没有活动 Agent 工作流</p>}
    </section>
  );
}

export function ProjectHub(props: {
  detail: DesktopProjectDetail;
  workspaceSettings?: ReactNode;
}) {
  return (
    <div className="project-hub">
      <ProjectOverview detail={props.detail} />
      <main className="project-hub-scroll">
        <div className="project-hub-content">
          <nav className="project-hub-local-actions" aria-label="项目本地配置">
            <Link to={`/projects/${encodeURIComponent(props.detail.project.id)}/loops/models`}><Bot aria-hidden="true" size={15} />配置 Loop 模型</Link>
          </nav>
          <ProjectRoadmap roadmap={props.detail.roadmap} />
          <ProjectTasks detail={props.detail} />
          <div className="project-resource-columns">
            <ProjectDocuments detail={props.detail} />
            <ProjectAgents agents={props.detail.agents} />
          </div>
          <ProjectRisks risks={props.detail.risks} />
          {props.workspaceSettings ? (
            <section className="project-hub-section project-workspace-section" aria-labelledby="project-workspace-title">
              <header>
                <h2 id="project-workspace-title">本地工作区</h2>
                <span>当前设备</span>
              </header>
              {props.workspaceSettings}
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}

export function ProjectHubPage(props: {
  runtime: LocalRuntime;
  render: (input: { content: React.ReactNode }) => React.ReactNode;
}) {
  const { projectId = "" } = useParams();
  const session = useDesktopSession();
  const storeQuery = useQuery({
    enabled: Boolean(props.runtime.isNative && session.localDeviceId),
    queryKey: ["desktop", "execution-configuration", session.localDeviceId ?? "disabled"],
    queryFn: () => createNativeExecutionConfigStore({ deviceId: session.localDeviceId ?? "" }),
    staleTime: Infinity,
  });
  const detailQuery = useQuery({
    enabled: Boolean(projectId && session.client && session.context),
    queryKey: session.context
      ? projectDetailQueryKey(session.context, projectId)
      : ["desktop", "projects", "detail", "disabled"],
    queryFn: async () => {
      if (!session.client || !session.context) throw new Error("桌面会话不可用");
      const search = new URLSearchParams({ space: session.context.spaceKey });
      return session.client.request(
        `/api/desktop/projects/${encodeURIComponent(projectId)}?${search.toString()}`,
        desktopProjectDetailResponseSchema,
      );
    },
  });

  if (detailQuery.isPending) {
    return props.render({ content: <div aria-label="正在加载项目详情" className="feature-loading-state" /> });
  }
  if (detailQuery.isError) {
    return props.render({ content: <p className="feature-error-state" role="alert">{detailQuery.error.message}</p> });
  }

  const detail = detailQuery.data.data.detail;
  const workspacePath = `/api/desktop/projects/${encodeURIComponent(projectId)}/workspace?${new URLSearchParams({
    space: session.context?.spaceKey ?? "personal",
  }).toString()}`;
  const saveWorkspace = async (input: WorkspaceConfigurationUpsertRequest) => {
    if (!session.client) throw new Error("桌面会话不可用");
    const response = await session.client.request(
      workspacePath,
      desktopWorkspaceConfigurationMutationResponseSchema,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    return response.data.workspace;
  };
  const removeWorkspace = async (input: WorkspaceConfigurationRevokeRequest) => {
    if (!session.client) throw new Error("桌面会话不可用");
    await session.client.request(
      workspacePath,
      desktopWorkspaceConfigurationMutationResponseSchema,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  };
  return props.render({
    content: <ProjectHub
      detail={detail}
      workspaceSettings={<ProjectWorkspaceSettings
        nativeAvailable={Boolean(
          props.runtime.isNative
          && session.bootstrap?.capabilities.nativeExecution
          && session.actionsEnabled,
        )}
        onRefresh={async () => { await detailQuery.refetch(); }}
        projectId={projectId}
        removeWorkspace={removeWorkspace}
        runtime={props.runtime}
        saveWorkspace={saveWorkspace}
        serverWorkspace={detail.workspace}
        store={storeQuery.data ?? null}
      />}
    />,
  });
}
