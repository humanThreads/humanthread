import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getWorkbenchShellLoginProps } from "../../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../../lib/workbench/workbench-companies";
import { readProjectLoopSettings } from "../../../../lib/orchestration/loop-product-read-model";
import { getProjectHubView, getWorkbenchProjects } from "../../../../lib/workbench/workbench-projects";
import { requireWorkbenchSession } from "../../../../lib/workbench/workbench-route-auth";
import { getSingleWorkbenchSearchParam, getWorkbenchSelectedSpaceFilter, PROJECT_SPACE_SEARCH_PARAM, WORKBENCH_SPACE_COOKIE, type WorkbenchSearchParams } from "../../../../lib/workbench/workbench-space-filters";
import { ProjectLoopBindings } from "../../../components/loops/project-loop-bindings";
import { ProjectLifecyclePanel, type ProjectLifecycleStatus } from "../../../components/projects/project-lifecycle-panel";
import { ProjectSettingsPanel } from "../../../components/projects/project-settings-panel";
import { ProjectSettingsTabs } from "../../../components/projects/project-settings-tabs";
import { ProjectWorkerDeploymentPanel } from "../../../components/projects/project-worker-deployment-panel";
import { ProjectOnboardingWizard } from "../../../components/projects/project-onboarding-wizard";
import { WorkbenchShell } from "../../../components/workbench-shell";
import { EmptyState, Panel } from "../../../components/workbench-ui";
import { buildProjectLoopSettingsModel } from "../loops/page";
import { projectRepositoryConfigurationSchema } from "@humanthread/shared";

export const dynamic = "force-dynamic";
export const PROJECT_SETTINGS_PAGE_TITLE = "项目设置";
export const PROJECT_SETTINGS_TABS = ["overview", "short-code", "loops", "environment", "workers", "onboarding"] as const;
export type ProjectSettingsTab = typeof PROJECT_SETTINGS_TABS[number];

export function resolveProjectSettingsTab(searchParams: Record<string, string | string[] | undefined>): ProjectSettingsTab {
  const tab = typeof searchParams.tab === "string" ? searchParams.tab : undefined;
  return PROJECT_SETTINGS_TABS.includes(tab as ProjectSettingsTab) ? tab as ProjectSettingsTab : "overview";
}

export default async function ProjectSettingsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams?: Promise<WorkbenchSearchParams> }) {
  const [{ projectId }, raw] = await Promise.all([params, searchParams ?? Promise.resolve({})]);
  const { session, cookieStore } = await requireWorkbenchSession(`/projects/${projectId}/settings`);
  const [view, filters, quickCreateProjects, loopSettings] = await Promise.all([
    getProjectHubView({ projectId, userId: session.context.userId }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
    getWorkbenchProjects({ userId: session.context.userId }),
    readProjectLoopSettings({ userId: session.context.userId, projectId }),
  ]);
  if (!view) notFound();
  const selected = getWorkbenchSelectedSpaceFilter({ filters, searchParamValue: getSingleWorkbenchSearchParam(raw, PROJECT_SPACE_SEARCH_PARAM), cookieValue: cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value });
  const activeTab = resolveProjectSettingsTab(raw);
  const loopModel = loopSettings ? buildProjectLoopSettingsModel(loopSettings) : null;
  const repositoryConfiguration = projectRepositoryConfigurationSchema.safeParse(view.project.repositoryConfiguration);
  const repositoryCredentialVerified = repositoryConfiguration.success
    && repositoryConfiguration.data.verification.status === "passed";
  const openMilestoneCount = view.roadmap.reduce((count, stage) => count + stage.milestones.filter((milestone) => milestone.status !== "completed" && milestone.status !== "cancelled").length, 0);
  const panelProps = {
    projectId,
    spaceId: view.project.spaceId,
    shortCode: view.project.shortCode,
    version: view.project.version,
    canEdit: view.project.capabilities.edit,
    developmentTemplateKey: view.project.developmentTemplateKey,
    developmentTemplateVersion: view.project.developmentTemplateVersion,
    developmentTemplateConfig: view.project.developmentTemplateConfig,
    productionBranch: view.project.productionBranch,
    stagingBranch: view.project.stagingBranch,
    releaseAgentProfileId: view.project.releaseAgentProfileId,
    environmentConfiguration: view.project.environmentConfiguration,
    environmentConfigurationVersion: view.project.environmentConfigurationVersion,
    developmentLoopVersionId: view.project.developmentLoopVersionId,
    releaseLoopVersionId: view.project.releaseLoopVersionId,
  };
  return <WorkbenchShell activeKey="projects" title={`${view.project.name} · ${PROJECT_SETTINGS_PAGE_TITLE}`} subtitle="项目配置、执行资源与开箱准备" loginEmail={session.loginEmail} spaceLabel={selected.label} selectedSpaceKey={selected.key} spaceFilters={filters} quickCreateProjects={quickCreateProjects} {...getWorkbenchShellLoginProps(session)}>
    <main className="h-full overflow-y-auto bg-[#f6f8fa] p-5"><div className="mx-auto grid max-w-6xl gap-4"><Link href={`/projects/${encodeURIComponent(projectId)}`} className="inline-flex w-fit items-center gap-2 text-sm font-medium text-[#0969da] hover:underline"><ArrowLeft size={16} />返回项目</Link><header><h1 className="text-2xl font-semibold text-[#24292f]">{PROJECT_SETTINGS_PAGE_TITLE}</h1><p className="mt-1 text-sm text-[#57606a]">配置不会改变已创建 Loop 运行使用的版本；敏感凭证只保留来源引用。</p></header><ProjectSettingsTabs projectId={projectId} activeTab={activeTab} canEdit={view.project.capabilities.edit}>{activeTab === "overview" ? <><Panel title="项目配置进度"><p className="text-sm text-[#57606a]">按 Loop 工作流、环境与凭证、Worker Pool、部署命令、开箱向导的顺序完成配置。</p></Panel><Panel title="项目生命周期"><ProjectLifecyclePanel projectId={projectId} status={view.project.status as ProjectLifecycleStatus} version={view.project.version} canManage={view.project.capabilities.changeLifecycle} openMilestoneCount={openMilestoneCount} /></Panel></> : null}{activeTab === "short-code" ? <ProjectSettingsPanel {...panelProps} section="short-code" /> : null}{activeTab === "loops" ? loopModel ? <ProjectLoopBindings variant="workflow" model={loopModel} /> : <EmptyState title="尚未配置项目 Loop" description="请先选择项目级与任务级 Loop，再配置默认任务 Loop、默认里程碑 Loop及子流程映射。" /> : null}{activeTab === "environment" ? <ProjectSettingsPanel {...panelProps} {...(loopModel?.project.workerResource ? { workerResource: loopModel.project.workerResource, workerImageVersionId: loopModel.project.workerResource.imageVersionId } : {})} section="environment" /> : null}{activeTab === "workers" ? <ProjectWorkerDeploymentPanel projectId={projectId} projectShortCode={view.project.shortCode} projectVersion={view.project.version} environmentConfigurationVersion={view.project.environmentConfigurationVersion} environmentConfiguration={view.project.environmentConfiguration} deploymentConfiguration={view.project.workerDeploymentConfiguration} {...(loopModel?.project.workerResource ? { workerResource: loopModel.project.workerResource, workerImageVersionId: loopModel.project.workerResource.imageVersionId } : {})} /> : null}{activeTab === "onboarding" ? <ProjectOnboardingWizard projectId={projectId} hasEnabledProjectLoop={loopSettings?.bindings.some((binding) => binding && typeof binding === "object" && (binding as { status?: unknown }).status === "enabled") === true} environmentConfiguration={view.project.environmentConfiguration} hasWorkerResource={Boolean(loopModel?.project.workerResource)} repositoryCredentialVerified={repositoryCredentialVerified} {...(loopModel?.project.workerResource?.poolId ? { workerPoolId: loopModel.project.workerResource.poolId } : {})} /> : null}</ProjectSettingsTabs></div></main>
  </WorkbenchShell>;
}
