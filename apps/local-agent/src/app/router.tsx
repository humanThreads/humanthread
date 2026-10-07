import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { WorkbenchNavigationKey } from "@humanthread/workbench-client";

import { DashboardPage } from "../features/dashboard/dashboard-page";
import { OnboardingRoute } from "../features/onboarding/onboarding-route";
import { ProjectHubPage } from "../features/projects/project-hub-page";
import { ProjectLoopModelPage } from "../features/projects/project-loop-model-page";
import { ProjectListPage } from "../features/projects/project-list-page";
import { TaskPage } from "../features/tasks/task-page";
import { TaskDetailPage, type DesktopNativeContext } from "../features/tasks/task-detail-page";
import { DesktopLogin, DesktopSessionLoading } from "../session/desktop-login";
import { useOptionalDesktopSession } from "../session/session-provider";
import { DesktopShell } from "./desktop-shell";
import { normalizeDesktopRoute } from "./route-restore";

const DOMAIN_TITLES: Record<WorkbenchNavigationKey, string> = {
  dashboard: "首页",
  tasks: "任务",
  agents: "Agents",
  notifications: "通知",
  team: "团队",
  projects: "项目",
  documents: "文档",
  reports: "报表",
  templates: "模板",
  settings: "设置",
};

const DocumentPage = lazy(async () => {
  const module = await import("../features/documents/document-page");
  return { default: module.DocumentPage };
});

const AgentPage = lazy(async () => {
  const module = await import("../features/agents/agent-page");
  return { default: module.AgentPage };
});

const NotificationPage = lazy(async () => {
  const module = await import("../features/notifications/notification-page");
  return { default: module.NotificationPage };
});

const TeamPage = lazy(async () => {
  const module = await import("../features/team/team-page");
  return { default: module.TeamPage };
});

const ReportsPage = lazy(async () => {
  const module = await import("../features/reports/reports-page");
  return { default: module.ReportsPage };
});

const TemplatesPage = lazy(async () => {
  const module = await import("../features/templates/templates-page");
  return { default: module.TemplatesPage };
});

const SettingsPage = lazy(async () => {
  const module = await import("../features/settings/settings-page");
  return { default: module.SettingsPage };
});

function DocumentRoute() {
  return (
    <RouteState domain="documents" hideFeatureHeader>
      <Suspense fallback={<div aria-label="正在加载文档工作区" className="feature-loading-state" />}>
        <DocumentPage />
      </Suspense>
    </RouteState>
  );
}

function NotificationRoute() {
  return (
    <RouteState domain="notifications" hideFeatureHeader>
      <Suspense fallback={<div aria-label="正在加载通知中心" className="feature-loading-state" />}>
        <NotificationPage />
      </Suspense>
    </RouteState>
  );
}

function RouteState(props: {
  domain: WorkbenchNavigationKey;
  children?: ReactNode;
  hideFeatureHeader?: boolean;
}) {
  return (
    <DesktopShell activeKey={props.domain}>
      <section
        className={`feature-page${props.hideFeatureHeader ? " feature-page-full" : ""}`}
        aria-label={props.hideFeatureHeader ? DOMAIN_TITLES[props.domain] : undefined}
        aria-labelledby={props.hideFeatureHeader ? undefined : `${props.domain}-title`}
      >
        {!props.hideFeatureHeader ? <header className="feature-page-header">
          <h1 id={`${props.domain}-title`}>{DOMAIN_TITLES[props.domain]}</h1>
        </header> : null}
        {props.children ?? (
          <div className="feature-loading-state" aria-live="polite">
            <span className="loading-line loading-line-wide" />
            <span className="loading-line" />
            <span className="loading-line loading-line-short" />
          </div>
        )}
      </section>
    </DesktopShell>
  );
}

function SettingsRoute(props: { runtime: DesktopNativeContext["runtime"] }) {
  return (
    <RouteState domain="settings">
      <Suspense fallback={<div aria-label="正在加载设置" className="feature-loading-state" />}>
        <SettingsPage runtime={props.runtime} />
      </Suspense>
    </RouteState>
  );
}

export function DesktopAppRouter(props: {
  native: DesktopNativeContext;
  onSuccessfulRoute?: (route: string) => void;
  onOnboardingChange?: (input: {
    skipped?: boolean;
    completedAt?: string | null;
  }) => void;
}) {
  const location = useLocation();
  const session = useOptionalDesktopSession();

  useEffect(() => {
    const route = normalizeDesktopRoute(`${location.pathname}${location.search}`);
    if (route) props.onSuccessfulRoute?.(route);
  }, [location.pathname, location.search, props.onSuccessfulRoute]);

  if (session) {
    if (
      session.status === "signed_out"
      || session.status === "authenticating"
      || (session.status === "error" && !session.client)
    ) {
      return <DesktopLogin />;
    }
    if (session.status === "bootstrapping") {
      return <DesktopSessionLoading label="正在建立安全会话" />;
    }
    if (session.status === "switching") {
      return <DesktopSessionLoading label="正在切换工作空间" />;
    }
    if (session.status === "error") {
      return <DesktopSessionLoading label={session.error ?? "工作空间暂不可用"} />;
    }
  }

  if (!session) {
    return <DesktopLogin />;
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/dashboard" />} />
      <Route path="/onboarding" element={
        <RouteState domain="settings" hideFeatureHeader>
          <OnboardingRoute
            accountSession={props.native.accountSession}
            onComplete={() => {
              props.onOnboardingChange?.({ completedAt: new Date().toISOString() });
            }}
            onSkip={() => {
              props.onOnboardingChange?.({ skipped: true });
            }}
            runtime={props.native.runtime}
            session={session}
          />
        </RouteState>
      } />
      <Route path="/dashboard/*" element={<RouteState domain="dashboard"><DashboardPage /></RouteState>} />
      <Route path="/tasks/:taskId" element={
        <TaskDetailPage
          native={props.native}
          render={({ content }) => (
            <RouteState domain="tasks" hideFeatureHeader>
              {content}
            </RouteState>
          )}
        />
      } />
      <Route path="/tasks" element={<RouteState domain="tasks"><TaskPage /></RouteState>} />
      <Route path="/agents/*" element={
        <Suspense fallback={<RouteState domain="agents"><div aria-label="正在加载 Agent 控制台" className="feature-loading-state" /></RouteState>}>
          <AgentPage render={({ content }) => (
            <RouteState domain="agents" hideFeatureHeader>{content}</RouteState>
          )} />
        </Suspense>
      } />
      <Route path="/notifications/*" element={<NotificationRoute />} />
      <Route path="/team/*" element={<RouteState domain="team"><Suspense fallback={<div aria-label="正在加载团队" className="feature-loading-state" />}><TeamPage /></Suspense></RouteState>} />
      <Route path="/projects/:projectId" element={
        <ProjectHubPage
          runtime={props.native.runtime}
          render={({ content }) => (
            <RouteState domain="projects" hideFeatureHeader>
              {content}
            </RouteState>
          )}
        />
      } />
      <Route path="/projects/:projectId/loops/models" element={
        <RouteState domain="projects" hideFeatureHeader>
          <ProjectLoopModelPage />
        </RouteState>
      } />
      <Route path="/projects" element={<RouteState domain="projects" hideFeatureHeader><ProjectListPage /></RouteState>} />
      <Route path="/documents/:documentId" element={<DocumentRoute />} />
      <Route path="/documents" element={<DocumentRoute />} />
      <Route path="/reports/*" element={<RouteState domain="reports"><Suspense fallback={<div aria-label="正在加载报表" className="feature-loading-state" />}><ReportsPage /></Suspense></RouteState>} />
      <Route path="/templates/*" element={<RouteState domain="templates"><Suspense fallback={<div aria-label="正在加载模板" className="feature-loading-state" />}><TemplatesPage /></Suspense></RouteState>} />
      <Route path="/settings/*" element={<SettingsRoute runtime={props.native.runtime} />} />
      <Route path="*" element={<Navigate replace to="/dashboard" />} />
    </Routes>
  );
}
