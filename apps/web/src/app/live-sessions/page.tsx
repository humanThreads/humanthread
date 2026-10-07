import { buildAccessibleProjectWhere, buildAccessibleTaskWhere, prisma } from "../../../../../packages/db/src/index";

import { LiveSessionWorkspace } from "../components/live-sessions/live-session-workspace";
import { WorkbenchShell } from "../components/workbench-shell";
import { getLiveSessionControl } from "../../lib/live-session/live-session-store";
import { getWorkbenchShellLoginProps } from "../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../lib/workbench/workbench-companies";
import { requireWorkbenchSession } from "../../lib/workbench/workbench-route-auth";

export const dynamic = "force-dynamic";

export default async function LiveSessionsPage() {
  const { session } = await requireWorkbenchSession("/live-sessions");
  const { context, loginEmail } = session;
  const [filters, projects, tasks, devices, pools, sessions] = await Promise.all([
    getWorkbenchCompanyFilters({ userId: context.userId }),
    prisma.project.findMany({
      where: buildAccessibleProjectWhere({ userId: context.userId }),
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, spaceId: true },
    }),
    prisma.task.findMany({
      where: {
        projectId: { not: null },
        statusCategory: { notIn: ["completed", "cancelled"] },
        ...buildAccessibleTaskWhere({ userId: context.userId }),
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 500,
      select: { id: true, title: true, projectId: true, statusCategory: true },
    }),
    prisma.localDevice.findMany({
      where: { userId: context.userId, status: "authorized" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        lastSeenAt: true,
        runtimeProfiles: { where: { status: "ready" }, take: 1, select: { id: true } },
        agentWorkers: { where: { status: "online" }, take: 1, select: { lastHeartbeatAt: true } },
      },
    }),
    prisma.project.findMany({
      where: {
        AND: [
          buildAccessibleProjectWhere({ userId: context.userId }),
          { workerPoolId: { not: null } },
        ],
      },
      select: {
        id: true,
        workerPool: {
          select: {
            id: true,
            displayName: true,
            status: true,
            lastSeenAt: true,
            sessions: { where: { status: "active", revokedAt: null }, take: 1, select: { id: true } },
          },
        },
      },
    }),
    getLiveSessionControl().list({ userId: context.userId }),
  ]);
  const now = new Date().getTime();

  return <WorkbenchShell
    activeKey="live-sessions"
    title="在线会话"
    subtitle="仅显示进行中的 Agent 与 Worker TUI 会话；公网服务不保存会话正文。"
    contentMode="workspace"
    loginEmail={loginEmail}
    spaceFilters={filters}
    {...getWorkbenchShellLoginProps(session)}
  >
    <LiveSessionWorkspace
      spaces={filters.flatMap((filter) => filter.spaceId ? [{ id: filter.spaceId, name: filter.label }] : [])}
      projects={projects.flatMap((project) => project.spaceId ? [{ ...project, spaceId: project.spaceId }] : [])}
      tasks={tasks.flatMap((task) => task.projectId ? [{ ...task, projectId: task.projectId }] : [])}
      devices={devices.map((device) => ({
        id: device.id,
        name: device.name,
        runtimeReady: device.runtimeProfiles.length > 0,
        online: Boolean(device.lastSeenAt && now - device.lastSeenAt.getTime() <= 30_000 && device.agentWorkers.length > 0),
      }))}
      workerPools={pools.flatMap((project) => project.workerPool ? [{
        projectId: project.id,
        poolId: project.workerPool.id,
        displayName: project.workerPool.displayName,
        online: project.workerPool.status === "active"
          && project.workerPool.sessions.length > 0
          && Boolean(project.workerPool.lastSeenAt && now - project.workerPool.lastSeenAt.getTime() <= 30_000),
      }] : [])}
      sessions={sessions}
    />
  </WorkbenchShell>;
}
