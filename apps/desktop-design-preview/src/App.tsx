import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import { OnboardingPage } from "./onboarding/onboarding-page";
import { loadOnboardingState, shouldOpenOnboarding } from "./onboarding/onboarding-state";
import { AgentsPage } from "./pages/agents-page";
import { DashboardPage } from "./pages/dashboard-page";
import { DocumentsPage } from "./pages/documents-page";
import { NotificationsPage } from "./pages/notifications-page";
import { ProjectDetailPage } from "./pages/project-detail-page";
import { ProjectsPage } from "./pages/projects-page";
import { ReportsPage } from "./pages/reports-page";
import { SettingsPage } from "./pages/settings-page";
import { TasksPage } from "./pages/tasks-page";
import { TeamPage } from "./pages/team-page";
import { TemplatesPage } from "./pages/templates-page";
import { DesktopShell } from "./shell/desktop-shell";
import type { DesktopNavigationKey } from "./shell/sidebar";
import { LoginPage, SessionLoading } from "./session/login-page";
import { PreviewSessionProvider, usePreviewSession } from "./session/preview-session";
import type { PreviewIdentityStorage } from "./api/preview-identity";

function WorkspaceRoute(props: {
  activeKey: DesktopNavigationKey;
  children: ReactNode;
}) {
  return <DesktopShell activeKey={props.activeKey}>{props.children}</DesktopShell>;
}

function PreviewFrame(props: {
  storage: PreviewIdentityStorage;
}) {
  const session = usePreviewSession();

  if (session.status === "signed_out" || session.status === "error") {
    return <LoginPage />;
  }
  if (session.status === "authenticating" || session.status === "bootstrapping") {
    return <SessionLoading label={session.status === "authenticating" ? "正在验证官网账号" : "正在读取工作台数据"} />;
  }

  return (
    <Routes>
      <Route
        path="/"
        element={(
          <Navigate
            replace
            to={shouldOpenOnboarding(loadOnboardingState(props.storage)) ? "/onboarding" : "/dashboard"}
          />
        )}
      />
      <Route
        path="/onboarding"
        element={(
          <DesktopShell activeKey="onboarding">
            <OnboardingPage storage={props.storage} />
          </DesktopShell>
        )}
      />
      <Route
        path="/dashboard"
        element={(
          <WorkspaceRoute activeKey="dashboard"><DashboardPage /></WorkspaceRoute>
        )}
      />
      <Route
        path="/tasks"
        element={<WorkspaceRoute activeKey="tasks"><TasksPage /></WorkspaceRoute>}
      />
      <Route
        path="/agents"
        element={<WorkspaceRoute activeKey="agents"><AgentsPage /></WorkspaceRoute>}
      />
      <Route
        path="/projects"
        element={<WorkspaceRoute activeKey="projects"><ProjectsPage /></WorkspaceRoute>}
      />
      <Route
        path="/projects/:projectId"
        element={<WorkspaceRoute activeKey="projects"><ProjectDetailPage /></WorkspaceRoute>}
      />
      <Route
        path="/documents"
        element={<WorkspaceRoute activeKey="documents"><DocumentsPage /></WorkspaceRoute>}
      />
      <Route
        path="/notifications"
        element={<WorkspaceRoute activeKey="notifications"><NotificationsPage /></WorkspaceRoute>}
      />
      <Route
        path="/reports"
        element={<WorkspaceRoute activeKey="reports"><ReportsPage /></WorkspaceRoute>}
      />
      <Route
        path="/templates"
        element={<WorkspaceRoute activeKey="templates"><TemplatesPage /></WorkspaceRoute>}
      />
      <Route
        path="/team"
        element={<WorkspaceRoute activeKey="team"><TeamPage /></WorkspaceRoute>}
      />
      <Route
        path="/settings"
        element={<WorkspaceRoute activeKey="settings"><SettingsPage /></WorkspaceRoute>}
      />
      <Route path="*" element={<Navigate replace to="/dashboard" />} />
    </Routes>
  );
}

export default function App(props: {
  fetch?: typeof fetch;
  storage?: PreviewIdentityStorage;
}) {
  const storage = props.storage ?? window.localStorage;
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 20_000,
      },
    },
  }));

  return (
    <PreviewSessionProvider {...(props.fetch ? { fetch: props.fetch } : {})} storage={storage}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <PreviewFrame storage={storage} />
        </BrowserRouter>
      </QueryClientProvider>
    </PreviewSessionProvider>
  );
}
