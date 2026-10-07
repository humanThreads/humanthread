import { getWorkbenchShellLoginProps } from "@/lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "@/lib/workbench/workbench-companies";
import { readLoopRunProjection } from "@/lib/orchestration/loop-read-model";
import { requireWorkbenchSession } from "@/lib/workbench/workbench-route-auth";
import { LoopRunViewer } from "../../components/loops/loop-run-viewer";
import { WorkbenchShell } from "../../components/workbench-shell";

export const dynamic = "force-dynamic";
export const LOOP_RUN_CONTENT_MODE = "workspace" as const;
export const LOOP_RUN_PAGE_TITLE = "Loop 运行图";

export default async function LoopRunPage({
  params,
}: {
  params: Promise<{ loopRunId: string }>;
}) {
  const { loopRunId } = await params;
  const requestedPath = `/loop-runs/${encodeURIComponent(loopRunId)}`;
  const { session } = await requireWorkbenchSession(requestedPath);
  const [projection, filters] = await Promise.all([
    readLoopRunProjection({ userId: session.context.userId, loopRunId }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
  ]);

  return (
    <WorkbenchShell
      activeKey="loops"
      title={LOOP_RUN_PAGE_TITLE}
      subtitle={`运行 ${projection.run.id}`}
      contentMode={LOOP_RUN_CONTENT_MODE}
      loginEmail={session.loginEmail}
      spaceFilters={filters}
      {...getWorkbenchShellLoginProps(session)}
    >
      <LoopRunViewer initialProjection={projection} />
    </WorkbenchShell>
  );
}
